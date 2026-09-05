'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { DoorOpen, Loader2, Trash2, Plus, X, CalendarDays, Monitor, Link2, HeartPulse } from 'lucide-react';
import {
  roomBookingApi,
  type Room, type CreateRoomInput, type RoomPrivacyMode, type BookableRoomStatus,
} from '@/lib/api';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { useModuleRouteGuard } from '@/hooks/useModuleRouteGuard';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelClass = 'text-xs text-gray-500 dark:text-gray-400 block mb-1';
const cardClass = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function toLocalDayRange(dateStr: string): { from: string; to: string } {
  const from = new Date(`${dateStr}T00:00:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// docs/modules/room_booking_module_plan.md §11 — dashboard experience for Room Booking: Rooms,
// Calendar, Displays, Integrations, Health. Core (native) + the Microsoft 365 connector milestone
// only — no Google Workspace (RB7) UI here yet (§4.2/§13 scope this module page to what's shipped).
export default function RoomBookingPage() {
  const qc = useQueryClient();
  const t = useTranslations('roomBooking');
  const canRender = useModuleRouteGuard('ROOM_BOOKING');
  const { confirmDelete } = useConfirmBeforeDelete();

  const [editingRoom, setEditingRoom] = useState<Room | 'new' | null>(null);
  const [calendarRoomId, setCalendarRoomId] = useState<string | null>(null);
  const [calendarDate, setCalendarDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addingReservation, setAddingReservation] = useState(false);
  const [mappingConnectionId, setMappingConnectionId] = useState<string | null>(null);

  const roomsQuery = useQuery({ queryKey: ['rooms'], queryFn: roomBookingApi.listRooms, enabled: canRender });
  const displaysQuery = useQuery({ queryKey: ['room-displays'], queryFn: roomBookingApi.listDisplays, enabled: canRender });
  const connectionsQuery = useQuery({ queryKey: ['room-booking', 'microsoft365-connections'], queryFn: roomBookingApi.listMicrosoft365Connections, enabled: canRender });

  const { from: dayFrom, to: dayTo } = toLocalDayRange(calendarDate);
  const reservationsQuery = useQuery({
    queryKey: ['room-booking', 'reservations', calendarRoomId, calendarDate],
    queryFn: () => roomBookingApi.listReservations(calendarRoomId!, dayFrom, dayTo),
    enabled: canRender && !!calendarRoomId,
  });

  const saveRoomMutation = useMutation({
    mutationFn: (input: { roomId: string | null; dto: CreateRoomInput }) =>
      input.roomId ? roomBookingApi.updateRoom(input.roomId, input.dto) : roomBookingApi.createRoom(input.dto),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['rooms'] }); setEditingRoom(null); },
  });
  const deleteRoomMutation = useMutation({
    mutationFn: (roomId: string) => roomBookingApi.removeRoom(roomId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rooms'] }),
  });
  const addReservationMutation = useMutation({
    mutationFn: (dto: { title?: string; organizerDisplayName?: string; startsAt: string; endsAt: string }) =>
      roomBookingApi.createReservation(calendarRoomId!, dto),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['room-booking', 'reservations'] }); setAddingReservation(false); },
  });
  const cancelReservationMutation = useMutation({
    mutationFn: (reservationId: string) => roomBookingApi.cancelReservation(calendarRoomId!, reservationId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['room-booking', 'reservations'] }),
  });
  const connectMutation = useMutation({
    mutationFn: (dto: { displayName: string; tenantId: string; clientId: string; clientSecret: string }) => roomBookingApi.connectMicrosoft365(dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['room-booking', 'microsoft365-connections'] }),
  });
  const disconnectMutation = useMutation({
    mutationFn: (connectionId: string) => roomBookingApi.disconnectMicrosoft365(connectionId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['room-booking', 'microsoft365-connections'] }); void qc.invalidateQueries({ queryKey: ['rooms'] }); },
  });
  const mapRoomMutation = useMutation({
    mutationFn: (input: { roomId: string; connectionId: string; externalResourceId: string; externalResourceEmail: string }) =>
      roomBookingApi.mapMicrosoft365Room(input.roomId, input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['rooms'] }); void qc.invalidateQueries({ queryKey: ['room-booking', 'microsoft365-connections'] }); },
  });
  const subscribeMutation = useMutation({
    mutationFn: (roomId: string) => roomBookingApi.subscribeMicrosoft365RoomWebhook(roomId),
  });

  if (!canRender) return null;

  const rooms = roomsQuery.data ?? [];
  const displays = displaysQuery.data ?? [];
  const connections = connectionsQuery.data ?? [];
  const reservations = reservationsQuery.data ?? [];
  const calendarRoom = rooms.find((r) => r.id === calendarRoomId) ?? null;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <DoorOpen className="w-6 h-6 text-indigo-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
      </div>

      {/* Rooms */}
      <section className={cardClass}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('rooms.title')}</h2>
          <button onClick={() => setEditingRoom('new')} className="flex items-center gap-1 text-sm text-indigo-600 hover:underline">
            <Plus className="w-4 h-4" /> {t('rooms.add')}
          </button>
        </div>
        {roomsQuery.isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        ) : rooms.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('rooms.none')}</p>
        ) : (
          <div className="space-y-2">
            {rooms.map((room) => (
              <div key={room.id} className="flex items-center justify-between border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{room.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {room.locationLabel ?? room.timezone} · {t(`rooms.provider.${room.providerKey}`)}
                    {room.status === 'OUT_OF_SERVICE' && <span className="ms-2 text-amber-600 dark:text-amber-500">{t('rooms.outOfService')}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button className="text-sm text-indigo-600 hover:underline" onClick={() => setEditingRoom(room)}>{t('rooms.edit')}</button>
                  <button
                    className="text-gray-400 hover:text-red-500"
                    onClick={() => { if (confirmDelete(t('rooms.confirmDelete'))) deleteRoomMutation.mutate(room.id); }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Calendar */}
      <section className={cardClass}>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2"><CalendarDays className="w-4 h-4" /> {t('calendar.title')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 mb-3">
          <select className={inputClass} value={calendarRoomId ?? ''} onChange={(e) => setCalendarRoomId(e.target.value || null)}>
            <option value="">{t('calendar.selectRoom')}</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input type="date" className={inputClass} value={calendarDate} onChange={(e) => setCalendarDate(e.target.value)} />
        </div>
        {calendarRoomId && (
          <>
            {reservationsQuery.isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            ) : reservations.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{t('calendar.none')}</p>
            ) : (
              <div className="space-y-1.5 mb-2">
                {reservations.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-1.5">
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-medium tabular-nums">
                        {new Date(r.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        {' – '}
                        {new Date(r.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      {' · '}{r.title ?? t('calendar.untitled')}
                      {r.organizerDisplayName && <span className="text-gray-400 dark:text-gray-500"> ({r.organizerDisplayName})</span>}
                    </div>
                    {r.providerKey === 'LUMINA' && (
                      <button className="text-gray-400 hover:text-red-500" onClick={() => cancelReservationMutation.mutate(r.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {calendarRoom?.providerKey === 'LUMINA' ? (
              <button className="text-sm text-indigo-600 hover:underline" onClick={() => setAddingReservation(true)}>{t('calendar.addReservation')}</button>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-600">{t('calendar.externalReadOnly')}</p>
            )}
          </>
        )}
      </section>

      {/* Displays */}
      <section className={cardClass}>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2"><Monitor className="w-4 h-4" /> {t('displays.title')}</h2>
        <p className="text-xs text-gray-400 dark:text-gray-600 mb-3">{t('displays.hint')}</p>
        {displays.filter((d) => d.roomDisplayBinding).length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('displays.none')}</p>
        ) : (
          <div className="space-y-2">
            {displays.filter((d) => d.roomDisplayBinding).map((d) => (
              <div key={d.id} className="flex items-center justify-between border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2 text-sm">
                <span className="text-gray-900 dark:text-gray-100">{d.name}</span>
                <span className="text-gray-500 dark:text-gray-400">{d.roomDisplayBinding!.room?.name ?? d.roomDisplayBinding!.roomId}</span>
                <span className="text-xs text-gray-400 dark:text-gray-600">
                  {d.roomDisplayBinding!.quickBookingEnabled ? t('displays.quickBookingOn') : t('displays.quickBookingOff')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Integrations */}
      <section className={cardClass}>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2"><Link2 className="w-4 h-4" /> {t('integrations.title')}</h2>
        <p className="text-xs text-gray-400 dark:text-gray-600 mb-3">{t('integrations.hint')}</p>
        <ConnectMicrosoft365Form onSubmit={(dto) => connectMutation.mutate(dto)} pending={connectMutation.isPending} />
        <div className="space-y-2 mt-4">
          {connections.map((c) => (
            <div key={c.id} className="border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.displayName}</div>
                <button className="text-sm text-gray-400 hover:text-red-500" onClick={() => disconnectMutation.mutate(c.id)}>{t('integrations.disconnect')}</button>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('integrations.roomsMapped', { count: c.roomCount })}</div>
              <button className="text-sm text-indigo-600 hover:underline mt-1" onClick={() => setMappingConnectionId(mappingConnectionId === c.id ? null : c.id)}>
                {t('integrations.mapRooms')}
              </button>
              {mappingConnectionId === c.id && (
                <MapRoomsPanel
                  connectionId={c.id}
                  rooms={rooms}
                  onMap={(input) => mapRoomMutation.mutate(input)}
                  onSubscribe={(roomId) => subscribeMutation.mutate(roomId)}
                  mapping={mapRoomMutation.isPending}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Health */}
      <section className={cardClass}>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2"><HeartPulse className="w-4 h-4" /> {t('health.title')}</h2>
        {connections.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('health.none')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {connections.map((c) => (
              <div key={c.id} className="border border-gray-100 dark:border-gray-800 rounded-lg p-3 text-sm">
                <div className="font-medium text-gray-900 dark:text-gray-100 mb-1">{c.displayName}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                  <div>{t('health.status')}: <span className={c.status === 'CONNECTED' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-500'}>{c.status}</span></div>
                  <div>{t('health.lastSync')}: {c.lastSuccessfulSyncAt ? new Date(c.lastSuccessfulSyncAt).toLocaleString() : t('health.never')}</div>
                  {c.lastErrorCode && <div className="text-red-500">{t('health.lastError')}: {c.lastErrorCode}</div>}
                  <div>{t('health.webhookExpires')}: {c.webhookExpiresAt ? new Date(c.webhookExpiresAt).toLocaleString() : t('health.none')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editingRoom && (
        <RoomModal
          room={editingRoom === 'new' ? null : editingRoom}
          onClose={() => setEditingRoom(null)}
          onSave={(dto) => saveRoomMutation.mutate({ roomId: editingRoom === 'new' ? null : editingRoom.id, dto })}
          saving={saveRoomMutation.isPending}
        />
      )}

      {addingReservation && calendarRoomId && (
        <ReservationModal
          date={calendarDate}
          onClose={() => setAddingReservation(false)}
          onSave={(dto) => addReservationMutation.mutate(dto)}
          saving={addReservationMutation.isPending}
        />
      )}
    </div>
  );
}

function RoomModal({ room, onClose, onSave, saving }: {
  room: Room | null;
  onClose: () => void;
  onSave: (dto: CreateRoomInput) => void;
  saving: boolean;
}) {
  const t = useTranslations('roomBooking');
  const [name, setName] = useState(room?.name ?? '');
  const [locationLabel, setLocationLabel] = useState(room?.locationLabel ?? '');
  const [timezone, setTimezone] = useState(room?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [capacity, setCapacity] = useState(room?.capacity != null ? String(room.capacity) : '');
  const [amenities, setAmenities] = useState(room?.amenities.join(', ') ?? '');
  const [privacyMode, setPrivacyMode] = useState<RoomPrivacyMode>(room?.privacyMode ?? 'BUSY_ONLY');
  const [status, setStatus] = useState<BookableRoomStatus>(room?.status ?? 'ACTIVE');

  return (
    <Modal title={room ? t('rooms.editTitle') : t('rooms.addTitle')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelClass}>{t('rooms.name')}</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>{t('rooms.locationLabel')}</label>
          <input className={inputClass} value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>{t('rooms.timezone')}</label>
          <TimezoneSelect value={timezone} onChange={setTimezone} />
        </div>
        <div>
          <label className={labelClass}>{t('rooms.capacity')}</label>
          <input type="number" min={0} className={inputClass} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>{t('rooms.amenities')}</label>
          <input className={inputClass} placeholder={t('rooms.amenitiesPlaceholder')} value={amenities} onChange={(e) => setAmenities(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>{t('rooms.privacyMode')}</label>
          <select className={inputClass} value={privacyMode} onChange={(e) => setPrivacyMode(e.target.value as RoomPrivacyMode)}>
            <option value="BUSY_ONLY">{t('rooms.privacy.BUSY_ONLY')}</option>
            <option value="SHOW_TITLE">{t('rooms.privacy.SHOW_TITLE')}</option>
            <option value="SHOW_ORGANIZER">{t('rooms.privacy.SHOW_ORGANIZER')}</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('rooms.status')}</label>
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as BookableRoomStatus)}>
            <option value="ACTIVE">{t('rooms.statusActive')}</option>
            <option value="OUT_OF_SERVICE">{t('rooms.outOfService')}</option>
          </select>
        </div>
        <button
          className="w-full mt-2 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          disabled={saving || !name.trim() || !timezone}
          onClick={() => onSave({
            name: name.trim(),
            locationLabel: locationLabel.trim() || undefined,
            timezone,
            capacity: capacity ? Number(capacity) : undefined,
            amenities: amenities.split(',').map((a) => a.trim()).filter(Boolean),
            privacyMode,
            status,
          })}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : t('rooms.save')}
        </button>
      </div>
    </Modal>
  );
}

function ReservationModal({ date, onClose, onSave, saving }: {
  date: string;
  onClose: () => void;
  onSave: (dto: { title?: string; organizerDisplayName?: string; startsAt: string; endsAt: string }) => void;
  saving: boolean;
}) {
  const t = useTranslations('roomBooking');
  const [title, setTitle] = useState('');
  const [organizerDisplayName, setOrganizerDisplayName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');

  return (
    <Modal title={t('calendar.addReservation')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelClass}>{t('calendar.reservationTitle')}</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>{t('calendar.organizer')}</label>
          <input className={inputClass} value={organizerDisplayName} onChange={(e) => setOrganizerDisplayName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>{t('calendar.startsAt')}</label>
            <input type="time" className={inputClass} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>{t('calendar.endsAt')}</label>
            <input type="time" className={inputClass} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <button
          className="w-full mt-2 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          disabled={saving || startTime >= endTime}
          onClick={() => onSave({
            title: title.trim() || undefined,
            organizerDisplayName: organizerDisplayName.trim() || undefined,
            startsAt: new Date(`${date}T${startTime}:00`).toISOString(),
            endsAt: new Date(`${date}T${endTime}:00`).toISOString(),
          })}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : t('calendar.save')}
        </button>
      </div>
    </Modal>
  );
}

function ConnectMicrosoft365Form({ onSubmit, pending }: {
  onSubmit: (dto: { displayName: string; tenantId: string; clientId: string; clientSecret: string }) => void;
  pending: boolean;
}) {
  const t = useTranslations('roomBooking');
  const [displayName, setDisplayName] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const canSubmit = displayName.trim() && tenantId.trim() && clientId.trim() && clientSecret.trim();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input className={inputClass} placeholder={t('integrations.displayName')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <input className={inputClass} placeholder={t('integrations.tenantId')} value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
      <input className={inputClass} placeholder={t('integrations.clientId')} value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <input className={inputClass} type="password" placeholder={t('integrations.clientSecret')} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
      <button
        className="sm:col-span-2 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        disabled={!canSubmit || pending}
        onClick={() => onSubmit({ displayName: displayName.trim(), tenantId: tenantId.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() })}
      >
        {pending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : t('integrations.connect')}
      </button>
    </div>
  );
}

function MapRoomsPanel({ connectionId, rooms, onMap, onSubscribe, mapping }: {
  connectionId: string;
  rooms: Room[];
  onMap: (input: { roomId: string; connectionId: string; externalResourceId: string; externalResourceEmail: string }) => void;
  onSubscribe: (roomId: string) => void;
  mapping: boolean;
}) {
  const t = useTranslations('roomBooking');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [selectedExternalId, setSelectedExternalId] = useState('');
  const mappableQuery = useQuery({
    queryKey: ['room-booking', 'microsoft365-mappable', connectionId],
    queryFn: () => roomBookingApi.listMappableMicrosoft365Rooms(connectionId),
  });
  const mappable = mappableQuery.data ?? [];
  const selectedExternal = mappable.find((m) => m.externalResourceId === selectedExternalId);

  return (
    <div className="mt-2 border-t border-gray-100 dark:border-gray-800 pt-2 space-y-2">
      {mappableQuery.isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      ) : mappable.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-600">{t('integrations.noMappableRooms')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select className={inputClass} value={selectedExternalId} onChange={(e) => setSelectedExternalId(e.target.value)}>
            <option value="">{t('integrations.selectExternalRoom')}</option>
            {mappable.map((m) => <option key={m.externalResourceId} value={m.externalResourceId}>{m.displayName}</option>)}
          </select>
          <select className={inputClass} value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)}>
            <option value="">{t('integrations.selectLuminaRoom')}</option>
            {rooms.filter((r) => r.providerKey === 'LUMINA').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button
            className="sm:col-span-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            disabled={!selectedRoomId || !selectedExternal || mapping}
            onClick={() => {
              if (!selectedExternal) return;
              onMap({ roomId: selectedRoomId, connectionId, externalResourceId: selectedExternal.externalResourceId, externalResourceEmail: selectedExternal.email });
              setSelectedRoomId(''); setSelectedExternalId('');
            }}
          >
            {t('integrations.map')}
          </button>
        </div>
      )}
      {rooms.filter((r) => r.calendarConnectionId === connectionId).map((r) => (
        <div key={r.id} className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>{r.name}</span>
          <button className="text-indigo-600 hover:underline" onClick={() => onSubscribe(r.id)}>{t('integrations.subscribeWebhook')}</button>
        </div>
      ))}
    </div>
  );
}
