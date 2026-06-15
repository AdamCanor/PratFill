// Source: GetAllFilterStatuses response.
// Emergency group (statusCode 99, isEmergency:true, futureReportDays:0) excluded
// since future reporting isn't allowed for it.

export const STATUSES = [
  {
    statusCode: '01',
    statusDescription: 'נמצא/ת ביחידה',
    icon: 'basis',
    secondaries: [
      { statusCode: '01', statusDescription: 'נוכח/ת' },
    ],
  },
  {
    statusCode: '02',
    statusDescription: 'מחוץ ליחידה',
    icon: 'location',
    secondaries: [
      { statusCode: '05', statusDescription: 'בתפקיד מחוץ ליחידה' },
      { statusCode: '09', statusDescription: 'אחרי תורנות / משמרת' },
      { statusCode: '03', statusDescription: 'עובד/ת משמרות' },
      { statusCode: '13', statusDescription: 'הפניה רפואית' },
      { statusCode: '16', statusDescription: 'משמרת ערב' },
      { statusCode: '02', statusDescription: 'אבט"ש' },
      { statusCode: '14', statusDescription: 'לימודים על סמך אישור' },
      { statusCode: '18', statusDescription: 'הצ"ח' },
      { statusCode: '20', statusDescription: 'סבב קו' },
      { statusCode: '23', statusDescription: 'יום פרט' },
      { statusCode: '24', statusDescription: 'השתלמות מקצועית בארץ' },
    ],
  },
  {
    statusCode: '04',
    statusDescription: 'חופשה שנתית',
    icon: 'beachHoliday',
    secondaries: [
      { statusCode: '01', statusDescription: 'חופשה שנתית' },
      { statusCode: '06', statusDescription: 'חג עדתי' },
      { statusCode: '10', statusDescription: 'חופשה ללא תשלום קצרה' },
      { statusCode: '11', statusDescription: 'אזכרה - קרבה ראשונה' },
      { statusCode: '13', statusDescription: 'חופשה צבורה' },
    ],
  },
  {
    statusCode: '05',
    statusDescription: 'חופשת מחלה',
    icon: 'pills',
    secondaries: [
      { statusCode: '01', statusDescription: 'חופשת מחלה (גימלים)' },
      { statusCode: '02', statusDescription: 'מחלה עפ"י הצהרה' },
      { statusCode: '07', statusDescription: 'מסע הורות' },
      { statusCode: '03', statusDescription: 'מחלת ילד/ה' },
      { statusCode: '04', statusDescription: 'מחלת הורה' },
      { statusCode: '16', statusDescription: 'שמירת הריון' },
      { statusCode: '05', statusDescription: 'מחלת בן/בת זוג' },
      { statusCode: '09', statusDescription: 'מחלת ילד/ה ממארת' },
      { statusCode: '10', statusDescription: 'מחלת בן/ת זוג ממארת' },
      { statusCode: '11', statusDescription: 'הריון או לידת בת זוג' },
      { statusCode: '12', statusDescription: 'תרומת מח עצם / איברים' },
      { statusCode: '14', statusDescription: 'הורה לבעל/ת מוגבלויות' },
      { statusCode: '15', statusDescription: 'מחלה בפציעה בתפקיד' },
      { statusCode: '28', statusDescription: 'בן משפחה מטפל' },
    ],
  },
  {
    statusCode: '13',
    statusDescription: 'חו"ל',
    icon: 'plane',
    secondaries: [
      { statusCode: '34', statusDescription: 'השתלמות מקצועית בחו"ל' },
    ],
  },
];

// Icons are served directly by the app's own server
export function iconUri(iconName) {
  return `https://one.prat.idf.il/img/${iconName}.png`;
}

export function getSecondaryLabel(mainCode, secondaryCode) {
  const main = STATUSES.find((s) => s.statusCode === mainCode);
  if (!main) return null;
  return main.secondaries.find((s) => s.statusCode === secondaryCode) || null;
}
