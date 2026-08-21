// Multi-language directory switching (7.4) — the player has no i18n library at all (unlike the
// dashboard's next-intl setup), and wayfinding data already carries bilingual fields (Poi.nameAr/
// descriptionAr, PoiCategory.labelAr) that nothing in the player read until now. Rather than pull
// in a full i18n framework for a handful of fixed UI strings, this is a small inline dictionary —
// consistent with how little fixed chrome text a kiosk actually needs.
export type WayfindingLang = 'en' | 'ar';

const STORAGE_KEY = 'lumina-wayfinding-lang';

const STRINGS = {
  en: {
    directory: 'Directory',
    search: 'Search…',
    directions: 'Directions',
    continueOnPhone: 'Continue on your phone',
    closed: 'Closed',
    relocated: 'Relocated',
    scanToTake: 'Scan to take these directions with you',
    youAreHere: 'You are here',
    tapToBrowse: 'Tap to browse the directory',
    noDirectoryData: 'No directory data yet',
    noListingsFloor: 'No listings on this floor yet',
    noFloorPlan: 'No floor plan uploaded',
    step: 'step',
    steps: 'steps',
    wheelchairAccessible: 'Wheelchair-accessible route',
    evacuate: 'EVACUATION IN PROGRESS',
    evacuateSub: 'Proceed calmly to the nearest exit',
    noExitFound: 'Proceed to the nearest marked exit',
    readAloud: 'Read directions aloud',
    stopReading: 'Stop reading',
    accessibilityMode: 'Larger text & buttons',
    directionsTo: 'Directions to',
    all: 'All',
    noMatches: 'No matches',
  },
  ar: {
    directory: 'الدليل',
    search: 'بحث…',
    directions: 'الاتجاهات',
    continueOnPhone: 'تابع على هاتفك',
    closed: 'مغلق',
    relocated: 'تم النقل',
    scanToTake: 'امسح الرمز لأخذ هذه الاتجاهات معك',
    youAreHere: 'أنت هنا',
    tapToBrowse: 'اضغط لتصفح الدليل',
    noDirectoryData: 'لا توجد بيانات دليل بعد',
    noListingsFloor: 'لا توجد متاجر في هذا الطابق بعد',
    noFloorPlan: 'لم يتم تحميل مخطط الطابق',
    step: 'خطوة',
    steps: 'خطوات',
    wheelchairAccessible: 'مسار متاح لذوي الاحتياجات الخاصة',
    evacuate: 'إخلاء جارٍ',
    evacuateSub: 'يرجى التوجه بهدوء إلى أقرب مخرج',
    noExitFound: 'توجه إلى أقرب مخرج محدد',
    readAloud: 'قراءة الاتجاهات بصوت عالٍ',
    stopReading: 'إيقاف القراءة',
    accessibilityMode: 'نص وأزرار أكبر',
    directionsTo: 'الاتجاهات إلى',
    all: 'الكل',
    noMatches: 'لا توجد نتائج',
  },
} satisfies Record<WayfindingLang, Record<string, string>>;

export type WayfindingStringKey = keyof typeof STRINGS.en;

export function t(key: WayfindingStringKey, lang: WayfindingLang): string {
  return STRINGS[lang][key];
}

export function loadWayfindingLang(): WayfindingLang {
  if (typeof window === 'undefined') return 'en';
  return window.localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en';
}

export function saveWayfindingLang(lang: WayfindingLang) {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, lang);
}

export function pickName(item: { name: string; nameAr?: string | null }, lang: WayfindingLang): string {
  return (lang === 'ar' && item.nameAr) ? item.nameAr : item.name;
}

export function pickDescription(
  item: { description: string | null; descriptionAr?: string | null },
  lang: WayfindingLang,
): string | null {
  return (lang === 'ar' && item.descriptionAr) ? item.descriptionAr : item.description;
}

export function pickCategoryLabel(cat: { label: string; labelAr?: string | null }, lang: WayfindingLang): string {
  return (lang === 'ar' && cat.labelAr) ? cat.labelAr : cat.label;
}
