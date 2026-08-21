// Default POI categories seeded once with organizationId: null (system rows every org can see
// and use, same "system row" pattern as THEME_PRESETS/library assets) — orgs can add their own
// custom categories alongside these but can't edit/delete the defaults.
//
// `icon` is a lucide-react icon component name (dashboard/player already depend on lucide-react
// for other UI icons) — kept as a plain string, like FONT_LIBRARY ids, so the curated set can
// grow without a migration.
export interface PoiCategoryPreset {
  label: string;
  labelAr: string;
  icon: string;
  color: string;
}

export const POI_CATEGORY_PRESETS: PoiCategoryPreset[] = [
  { label: 'Store', labelAr: 'متجر', icon: 'Store', color: '#2563eb' },
  { label: 'Restroom', labelAr: 'دورة مياه', icon: 'Toilet', color: '#0891b2' },
  { label: 'Elevator', labelAr: 'مصعد', icon: 'ArrowUpDown', color: '#7c3aed' },
  { label: 'Stairs', labelAr: 'درج', icon: 'Footprints', color: '#7c3aed' },
  { label: 'Exit', labelAr: 'مخرج', icon: 'DoorOpen', color: '#dc2626' },
  { label: 'Food & Dining', labelAr: 'مطاعم', icon: 'UtensilsCrossed', color: '#ea580c' },
  { label: 'ATM / Bank', labelAr: 'صراف آلي', icon: 'Landmark', color: '#16a34a' },
  { label: 'Parking', labelAr: 'موقف سيارات', icon: 'ParkingCircle', color: '#4b5563' },
  { label: 'Information', labelAr: 'معلومات', icon: 'Info', color: '#2563eb' },
  { label: 'Accessibility', labelAr: 'ذوو الاحتياجات الخاصة', icon: 'Accessibility', color: '#0891b2' },
  { label: 'Baby Care', labelAr: 'رعاية الأطفال', icon: 'Baby', color: '#db2777' },
  { label: 'Medical / Clinic', labelAr: 'عيادة طبية', icon: 'Stethoscope', color: '#dc2626' },
];
