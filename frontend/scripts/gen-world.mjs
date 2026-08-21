/**
 * แปลงข้อมูลชายฝั่งโลก + จุดเมือง เป็นพิกัดที่ฉายไว้แล้วสำหรับภาพลูกโลกหน้า login
 *
 * ── ทำไมแปลงตอนนี้ ไม่ใช่ตอนรัน ───────────────────────────────────────────
 * แผนที่ไม่เคยเปลี่ยน และมุมที่มองก็ตายตัว จึงไม่มีเหตุให้ถอด TopoJSON แล้วฉายพิกัด
 * ใหม่ทุกครั้งที่เปิดหน้าเว็บ — ทำครั้งเดียวตอนนี้แล้วเก็บผลไว้ หน้าเว็บเหลือแค่วาด
 * <path> และไม่ต้องพก topojson-client/d3-geo ไปกับ bundle เลยสักตัว
 *
 * ── ข้อมูล ────────────────────────────────────────────────────────────────
 * world-atlas (ISC) ซึ่งแปลงมาจาก Natural Earth — ข้อมูลเป็นสาธารณสมบัติ
 * ใช้ชั้นความละเอียดต่ำสุด (110m) เพราะเป็นภาพประกอบ ไม่ใช่แผนที่ที่ต้องอ่านค่า
 *
 * รัน: node scripts/gen-world.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

/** กรอบภาพสี่เหลี่ยมจัตุรัส ลูกโลกอยู่กลาง */
const SIZE = 440;
const R = 200;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** มุมที่มองลูกโลก — เลือกให้เห็นทวีปที่มีเมืองในรายการมากที่สุด */
const LON0 = 34;
const LAT0 = 18;

/** วงที่เล็กกว่านี้เป็นเกาะเม็ดเล็กที่ขนาดนี้มองไม่เห็น — ตัดทิ้งเพื่อลดขนาดไฟล์ */
const MIN_AREA = 2;
/** ระยะขั้นต่ำระหว่างจุดที่เก็บไว้ (หน่วยเดียวกับกรอบภาพ) */
const MIN_STEP = 1.6;

const rad = (d) => (d * Math.PI) / 180;
const sinLat0 = Math.sin(rad(LAT0));
const cosLat0 = Math.cos(rad(LAT0));

/**
 * ฉายแบบ orthographic — มุมมองเดียวกับที่ตามองลูกโลกจริงจากระยะไกล
 * คืน null ถ้าจุดอยู่อีกซีกของโลก (มองไม่เห็น เพราะตัวโลกบังอยู่)
 */
function project(lon, lat) {
  const dLon = rad(lon - LON0);
  const la = rad(lat);
  const cosC = sinLat0 * Math.sin(la) + cosLat0 * Math.cos(la) * Math.cos(dLon);
  if (cosC < 0) return null; // อยู่ด้านหลังลูกโลก
  return {
    x: CX + R * Math.cos(la) * Math.sin(dLon),
    y: CY - R * (cosLat0 * Math.sin(la) - sinLat0 * Math.cos(la) * Math.cos(dLon)),
  };
}

/** พื้นที่ของรูปหลายเหลี่ยม (shoelace) ใช้ตัดวงเล็กๆ ทิ้ง */
function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return Math.abs(a / 2);
}

const topo = JSON.parse(readFileSync('node_modules/world-atlas/land-110m.json', 'utf8'));
const land = feature(topo, topo.objects.land);

const paths = [];
for (const f of land.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      // แอนตาร์กติกาที่มุมมองนี้เหลือเป็นแถบบางๆ ขอบล่าง ไม่ได้เพิ่มอะไรให้ภาพ
      if (ring.some(([, lat]) => lat < -60)) continue;

      /* จุดที่อยู่อีกซีกของโลกต้อง "ตัดเส้น" ไม่ใช่ "ข้ามไปต่อจุดถัดไป" —
         ถ้าข้ามไปต่อเลย เส้นจะลากพาดหน้าลูกโลกจากขอบหนึ่งไปอีกขอบหนึ่ง
         (ปัญหาเดียวกับตอนทำแผนที่แบนแล้วเจอเส้นพาดตรงเส้นแบ่งวันสากล) */
      let run = [];
      const runs = [];
      for (const [lon, lat] of ring) {
        const p = project(lon, lat);
        if (p) run.push(p);
        else if (run.length) {
          runs.push(run);
          run = [];
        }
      }
      if (run.length) runs.push(run);

      for (const seg of runs) {
        const pts = seg.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
        if (pts.length < 4) continue;
        if (area(pts) < MIN_AREA) continue;
        // ทิ้งจุดที่ชิดจุดก่อนหน้ามากเกินไป — ที่ขนาดแสดงผลจริงมันทับกันอยู่แล้ว
        const thin = [pts[0]];
        for (const pt of pts.slice(1)) {
          const last = thin[thin.length - 1];
          if (Math.hypot(pt.x - last.x, pt.y - last.y) >= MIN_STEP) thin.push(pt);
        }
        if (thin.length < 4) continue;
        paths.push('M' + thin.map((p) => `${p.x} ${p.y}`).join('L') + 'Z');
      }
    }
  }
}

/**
 * เมืองที่เอามาเป็นจุดบนลูกโลก — ใช้พิกัดจริง ไม่สุ่ม
 * จุดสุ่มจะไปตกกลางมหาสมุทรเป็นเรื่องปกติ ซึ่งคนดูจับได้ว่าไม่ได้สื่ออะไร
 * เมืองที่อยู่อีกซีกของโลกจะถูกตัดออกเองตอนฉาย (project คืน null)
 */
const CITIES = [
  { name: 'กรุงเทพฯ', lon: 100.5, lat: 13.75 },
  { name: 'โตเกียว', lon: 139.7, lat: 35.7 },
  { name: 'ปักกิ่ง', lon: 116.4, lat: 39.9 },
  { name: 'สิงคโปร์', lon: 103.8, lat: 1.35 },
  { name: 'เดลี', lon: 77.2, lat: 28.6 },
  { name: 'ดูไบ', lon: 55.3, lat: 25.2 },
  { name: 'ลอนดอน', lon: -0.13, lat: 51.5 },
  { name: 'เบอร์ลิน', lon: 13.4, lat: 52.5 },
  { name: 'มอสโก', lon: 37.6, lat: 55.75 },
  { name: 'ลากอส', lon: 3.4, lat: 6.5 },
  { name: 'ไคโร', lon: 31.2, lat: 30.0 },
  { name: 'โจฮันเนสเบิร์ก', lon: 28.0, lat: -26.2 },
  { name: 'ซิดนีย์', lon: 151.2, lat: -33.9 },
  { name: 'ไนโรบี', lon: 36.8, lat: -1.3 },
  { name: 'อิสตันบูล', lon: 29.0, lat: 41.0 },
];

/** คู่ที่ลากเส้นเชื่อม อ้างด้วยชื่อ — ถ้าปลายทางฝั่งใดอยู่หลังโลก คู่นั้นถูกตัดออกเอง */
const LINK_NAMES = [
  ['กรุงเทพฯ', 'โตเกียว'],
  ['กรุงเทพฯ', 'สิงคโปร์'],
  ['กรุงเทพฯ', 'เดลี'],
  ['กรุงเทพฯ', 'ดูไบ'],
  ['ปักกิ่ง', 'มอสโก'],
  ['สิงคโปร์', 'ซิดนีย์'],
  ['เดลี', 'ดูไบ'],
  ['ดูไบ', 'ไคโร'],
  ['ลอนดอน', 'เบอร์ลิน'],
  ['เบอร์ลิน', 'มอสโก'],
  ['อิสตันบูล', 'ไคโร'],
  ['ไคโร', 'ลากอส'],
  ['ลากอส', 'โจฮันเนสเบิร์ก'],
  ['ไนโรบี', 'โจฮันเนสเบิร์ก'],
  ['ไคโร', 'ลอนดอน'],
  ['เดลี', 'ปักกิ่ง'],
];

const visible = [];
for (const c of CITIES) {
  const p = project(c.lon, c.lat);
  if (p) visible.push({ ...c, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
}
const indexOf = new Map(visible.map((c, i) => [c.name, i]));
const links = LINK_NAMES.map(([a, b]) => [indexOf.get(a), indexOf.get(b)]).filter(
  ([a, b]) => a !== undefined && b !== undefined,
);

const out = `/**
 * ลูกโลกฉายแบบ orthographic ไว้แล้วในกรอบ ${SIZE}x${SIZE} (รัศมี ${R}, ศูนย์กลาง ${CX},${CY})
 * มองจากลองจิจูด ${LON0} ละติจูด ${LAT0} องศา
 *
 * ⚠️ ไฟล์นี้สร้างด้วย scripts/gen-world.mjs — อย่าแก้ด้วยมือ
 * ข้อมูลต้นทาง: world-atlas (ISC) ซึ่งแปลงจาก Natural Earth (สาธารณสมบัติ)
 */
export const GLOBE_SIZE = ${SIZE};
export const GLOBE_R = ${R};
export const GLOBE_CX = ${CX};
export const GLOBE_CY = ${CY};

/** ชายฝั่งของแผ่นดินที่หันเข้าหาคนดู (ซีกหลังถูกตัวโลกบัง จึงไม่ได้เก็บมา) */
export const GLOBE_PATHS: string[] = [
${paths.map((p) => `  '${p}',`).join('\n')}
];

/** จุดเมืองที่มองเห็นจากมุมนี้ */
export const GLOBE_NODES: { x: number; y: number }[] = [
${visible.map((c) => `  { x: ${c.x}, y: ${c.y} }, // ${c.name}`).join('\n')}
];

/** คู่ที่ลากเส้นเชื่อมกัน (อ้างด้วยดัชนีใน GLOBE_NODES) */
export const GLOBE_LINKS: [number, number][] = [
${links.map(([a, b]) => `  [${a}, ${b}],`).join('\n')}
];
`;

writeFileSync('src/app/lib/worldGlobe.ts', out);
console.log(
  `เขียน src/app/lib/worldGlobe.ts — ${paths.length} วง, ${visible.length}/${CITIES.length} เมือง, ` +
    `${links.length}/${LINK_NAMES.length} เส้น, ${(out.length / 1024).toFixed(1)} KB`,
);
