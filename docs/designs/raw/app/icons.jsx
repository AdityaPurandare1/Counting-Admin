// Icon atoms — inline SVG, solid/filled Material-style glyphs
// All sized via currentColor so tonal use is trivial.

const Ic = {
  search: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>,
  barcode: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M2 4h2v16H2zm3 0h1v16H5zm2 0h2v16H7zm3 0h2v16h-2zm3 0h1v16h-1zm2 0h2v16h-2zm3 0h1v16h-1zm2 0h2v16h-2z"/></svg>,
  camera: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M9 3 7.17 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.17L15 3H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/><circle cx="12" cy="13" r="3.2"/></svg>,
  edit: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>,
  check: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>,
  checkCircle: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.4-1.4L10 14.2l7.6-7.6L19 8l-9 9z"/></svg>,
  close: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>,
  plus: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>,
  minus: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M5 11h14v2H5z"/></svg>,
  arrowRight: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>,
  chevronRight: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M8.6 5.6 7.2 7l5 5-5 5 1.4 1.4L15 12z"/></svg>,
  chevronLeft: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M15.4 5.6 9 12l6.4 6.4 1.4-1.4L11.8 12l5-5z"/></svg>,
  menu: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg>,
  home: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>,
  chart: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M5 9h3v11H5zm5-6h3v17h-3zm5 9h3v8h-3z"/></svg>,
  list: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z"/></svg>,
  clipboard: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-4.18A3 3 0 0 0 9.18 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1-1 1 1 1 0 0 1 1-1z"/></svg>,
  upload: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4zM5 18h14v2H5z"/></svg>,
  download: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7zM5 18h14v2H5z"/></svg>,
  alert: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 1 21h22L12 2zm1 14h-2v-2h2zm0-4h-2V8h2z"/></svg>,
  flag: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>,
  flash: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>,
  user: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg>,
  lock: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM12 17a2 2 0 1 1 2-2 2 2 0 0 1-2 2zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0z"/></svg>,
  sparkle: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.2 5.3L20 10l-5.8 2 L12 17l-2.2-5L4 10l5.8-1.7z"/></svg>,
  filter: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16l-6 8v6l-4-2v-4z"/></svg>,
  dot: (s=6) => <svg width={s} height={s} viewBox="0 0 6 6" fill="currentColor"><circle cx="3" cy="3" r="3"/></svg>,
  scan: (s=20) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M3 12h18"/></svg>,
  wine: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M8 2v6a4 4 0 0 0 3 3.87V20H8v2h8v-2h-3v-8.13A4 4 0 0 0 16 8V2H8zm6 2v2h-4V4h4z"/></svg>,
  file: (s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7zm-1 7V3.5L18.5 10H13a1 1 0 0 1-1-1z"/></svg>,
};

window.Ic = Ic;
