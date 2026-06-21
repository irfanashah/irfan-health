// ============================================================
// Inline SVG icons (lucide-style paths). Stroke-based, currentColor.
// ============================================================
const Icon = ({ children, size = 20, stroke = 2, className = '', style }) =>
  React.createElement(
    'svg',
    {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round',
      strokeLinejoin: 'round', className, style, 'aria-hidden': true,
    },
    children
  );

const P = (d, key) => React.createElement('path', { d, key });
const L = (x1, y1, x2, y2, key) => React.createElement('line', { x1, y1, x2, y2, key });
const C = (cx, cy, r, key) => React.createElement('circle', { cx, cy, r, key });

const Icons = {
  Heart: (p) => <Icon {...p}>{P('M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z')}</Icon>,
  HeartPulse: (p) => <Icon {...p}>{[P('M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z','a'), P('M3.22 12H9.5l.5-1 2 4 .5-2 1 1h5.27','b')]}</Icon>,
  Activity: (p) => <Icon {...p}>{P('M22 12h-4l-3 9L9 3l-3 9H2')}</Icon>,
  Droplet: (p) => <Icon {...p}>{P('M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z')}</Icon>,
  Moon: (p) => <Icon {...p}>{P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z')}</Icon>,
  Bed: (p) => <Icon {...p}>{[P('M2 4v16','a'), P('M2 8h18a2 2 0 0 1 2 2v10','b'), P('M2 17h20','c'), P('M6 8v9','d')]}</Icon>,
  Scale: (p) => <Icon {...p}>{[P('M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z','a'), P('M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z','b'), P('M7 21h10','c'), P('M12 3v18','d'), P('M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2','e')]}</Icon>,
  Pill: (p) => <Icon {...p}>{[P('M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z','a'), L(8.5, 8.5, 15.5, 15.5,'b')]}</Icon>,
  Sun: (p) => <Icon {...p}>{[C(12, 12, 4,'a'), P('M12 2v2','b'), P('M12 20v2','c'), P('M4.93 4.93l1.41 1.41','d'), P('M17.66 17.66l1.41 1.41','e'), P('M2 12h2','f'), P('M20 12h2','g'), P('M6.34 17.66l-1.41 1.41','h'), P('M19.07 4.93l-1.41 1.41','i')]}</Icon>,
  Calendar: (p) => <Icon {...p}>{[P('M8 2v4','a'), P('M16 2v4','b'), React.createElement('rect', { key: 'c', x: 3, y: 4, width: 18, height: 18, rx: 2 }), P('M3 10h18','d')]}</Icon>,
  ChevronDown: (p) => <Icon {...p}>{P('M6 9l6 6 6-6')}</Icon>,
  Plus: (p) => <Icon {...p}>{[P('M5 12h14','a'), P('M12 5v14','b')]}</Icon>,
  Check: (p) => <Icon {...p}>{P('M20 6 9 17l-5-5')}</Icon>,
  AlertTriangle: (p) => <Icon {...p}>{[P('M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z','a'), L(12, 9, 12, 13,'b'), L(12, 17, 12.01, 17,'c')]}</Icon>,
  ArrowUp: (p) => <Icon {...p}>{[P('M12 19V5','a'), P('M5 12l7-7 7 7','b')]}</Icon>,
  ArrowDown: (p) => <Icon {...p}>{[P('M12 5v14','a'), P('M19 12l-7 7-7-7','b')]}</Icon>,
  ArrowRight: (p) => <Icon {...p}>{[P('M5 12h14','a'), P('M12 5l7 7-7 7','b')]}</Icon>,
  ArrowUpRight: (p) => <Icon {...p}>{[P('M7 17 17 7','a'), P('M7 7h10v10','b')]}</Icon>,
  ArrowDownRight: (p) => <Icon {...p}>{[P('M7 7 17 17','a'), P('M17 7v10H7','b')]}</Icon>,
  TrendingUp: (p) => <Icon {...p}>{[P('M22 7 13.5 15.5 8.5 10.5 2 17','a'), P('M16 7h6v6','b')]}</Icon>,
  TrendingDown: (p) => <Icon {...p}>{[P('M22 17 13.5 8.5 8.5 13.5 2 7','a'), P('M16 17h6v-6','b')]}</Icon>,
  Minus: (p) => <Icon {...p}>{P('M5 12h14')}</Icon>,
  X: (p) => <Icon {...p}>{[P('M18 6 6 18','a'), P('M6 6l12 12','b')]}</Icon>,
  Flame: (p) => <Icon {...p}>{P('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z')}</Icon>,
  NotebookPen: (p) => <Icon {...p}>{[P('M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4','a'), P('M2 6h4','b'), P('M2 10h4','c'), P('M2 14h4','d'), P('M2 18h4','e'), P('M18.4 2.6a2 2 0 0 1 3 3L16 11l-4 1 1-4Z','f')]}</Icon>,
  Footprints: (p) => <Icon {...p}>{[P('M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z','a'), P('M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z','b')]}</Icon>,
  Stethoscope: (p) => <Icon {...p}>{[P('M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .2.3','a'), P('M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4','b'), C(20, 10, 2,'c')]}</Icon>,
  Sparkles: (p) => <Icon {...p}>{[P('M9.94 14.66A4 4 0 0 1 7 12a4 4 0 0 1 2.94-2.66L12 4l2.06 5.34A4 4 0 0 1 17 12a4 4 0 0 1-2.94 2.66L12 20Z','a'), P('M22 5h-2','b'), P('M19 4v2','c')]}</Icon>,
  Watch: (p) => <Icon {...p}>{[C(12, 12, 6,'a'), P('M12 9v3l1.5 1.5','b'), P('M16.5 5.5 16 2H8l-.5 3.5','c'), P('M7.5 18.5 8 22h8l.5-3.5','d')]}</Icon>,
  Wind: (p) => <Icon {...p}>{[P('M12.8 19.6A2 2 0 1 0 14 16H2','a'), P('M17.5 8a2.5 2.5 0 1 1 2 4H2','b'), P('M9.8 4.4A2 2 0 1 1 11 8H2','c')]}</Icon>,
  Info: (p) => <Icon {...p}>{[C(12, 12, 10,'a'), L(12, 16, 12, 12,'b'), L(12, 8, 12.01, 8,'c')]}</Icon>,
};

Object.assign(window, { Icon, Icons });
