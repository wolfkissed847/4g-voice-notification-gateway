/**
 * แปลงข้อมูลชายฝั่งโลกเป็นไฟล์ path ของ SVG ที่ฉายไว้แล้ว
 *
 * ── ทำไมแปลงตอนนี้ ไม่ใช่ตอนรัน ───────────────────────────────────────────
 * แผนที่ไม่เคยเปลี่ยน จึงไม่มีเหตุให้ต้องถอด TopoJSON แล้วฉายพิกัดใหม่ทุกครั้งที่
 * เปิดหน้าเว็บ — ทำครั้งเดียวตอนนี้แล้วเก็บผลไว้ หน้าเว็บเหลือแค่วาด <path>
 * และไม่ต้องพก topojson-client/d3-geo ไปกับ bundle เลยสักตัว
 *
 * ── ข้อมูล ────────────────────────────────────────────────────────────────
 * world-atlas (ISC) ซึ่งแปลงมาจาก Natural Earth — ข้อมูลเป็นสาธารณสมบัติ
 * ใช้ชั้นความละเอียดต่ำสุด (110m) เพราะมันเป็นภาพประกอบพื้นหลัง ไม่ใช่แผนที่ที่ต้องอ่านค่า
 *
 * รัน: node scripts/gen-world.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

/** กรอบภาพ — อัตราส่วนตามช่วงละติจูดที่ตัดไว้ด้านล่าง */
const W = 1000;
/** ตัดขั้วโลกใต้ทิ้ง (แอนตาร์กติกา) และตัดขั้วเหนือส่วนที่ยืดจนผิดรูป
 *  แผนที่แบบ equirectangular ยิ่งใกล้ขั้วยิ่งยืดออกด้านข้าง ถ้าเอามาทั้งหมดกรีนแลนด์
 *  จะใหญ่กว่าแอฟริกา ซึ่งดูผิดจนสะดุดตา */
const LAT_MAX = 80;
const LAT_MIN = -56;
const H = Math.round((W * (LAT_MAX - LAT_MIN)) / 360);

/** วงที่เล็กกว่านี้เป็นเกาะเม็ดเล็กที่ขนาดนี้มองไม่เห็นอยู่แล้ว — ตัดทิ้งเพื่อลดขนาดไฟล์ */
const MIN_AREA = 1.4;
/** ระยะขั้นต่ำระหว่างจุดที่เก็บไว้ (หน่วยเดียวกับกรอบภาพ) */
const MIN_STEP = 1.6;

const topo = JSON.parse(readFileSync('node_modules/world-atlas/land-110m.json', 'utf8'));
const land = feature(topo, topo.objects.land);

const project = ([lon, lat]) => [
  ((lon + 180) / 360) * W,
  ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H,
];

/** พื้นที่ของรูปหลายเหลี่ยม (shoelace) ใช้ตัดวงเล็กๆ ทิ้ง */
function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
}

const paths = [];
for (const f of land.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      // แอนตาร์กติกาอยู่นอกกรอบที่เลือกไว้ทั้งวง — ข้ามไปเลย
      // (ถ้าเอามาแล้วหนีบพิกัดให้อยู่ในกรอบ จะได้แถบแบนพาดขอบล่างทั้งแผ่น)
      if (ring.some(([, lat]) => lat < -60)) continue;

      // หนีบพิกัดให้อยู่ในกรอบ ไม่ใช่ "กรองจุดที่อยู่นอกกรอบทิ้ง" แบบเดิม —
      // การกรองทิ้งทำให้วงปิดตัวเองด้วยการลากเส้นตรงข้ามช่องที่หายไป
      // ผลคือมีเส้นแนวนอนยาวพาดทั้งแผนที่ตรงกรีนแลนด์กับไซบีเรีย
      // หนีบแล้วขอบบนของแผ่นดินจะไปแนบขอบกรอบแทน ซึ่งเป็นสิ่งที่แผนที่ที่ถูกครอปทำกัน
      const pts = ring
        .map(project)
        .map(([x, y]) => [Math.round(x * 10) / 10, Math.round(Math.min(Math.max(y, 0), H) * 10) / 10]);
      if (pts.length < 4) continue;
      if (area(pts) < MIN_AREA) continue;
      // ทิ้งจุดที่อยู่ชิดจุดก่อนหน้ามากเกินไป — ที่ขนาดแสดงผลจริงมันทับกันอยู่แล้ว
      // แต่กินขนาดไฟล์เต็มๆ (ลดจาก 52KB เหลือราวครึ่งเดียวโดยรูปทรงไม่เปลี่ยน)
      const thin = [pts[0]];
      for (const pt of pts.slice(1)) {
        const last = thin[thin.length - 1];
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= MIN_STEP) thin.push(pt);
      }
      if (thin.length < 4) continue;

      // ตัดวงตรงที่กระโดดข้ามเส้นแบ่งวันสากล — แผ่นดินที่คร่อมลองจิจูด 180 (ไซบีเรีย
      // ฝั่งตะวันออก, ฟิจิ) พอฉายแบบ equirectangular จุดจะเด้งจากขอบขวาไปขอบซ้าย
      // ถ้าลากเส้นต่อกันตรงๆ จะได้เส้นแนวนอนพาดทั้งแผนที่ ขึ้นต้น subpath ใหม่แทน
      let d = `M${thin[0][0]} ${thin[0][1]}`;
      for (let k = 1; k < thin.length; k++) {
        const jump = Math.abs(thin[k][0] - thin[k - 1][0]) > W / 2;
        d += `${jump ? 'M' : 'L'}${thin[k][0]} ${thin[k][1]}`;
      }
      paths.push(d + 'Z');
    }
  }
}

const out = `/**
 * เส้นชายฝั่งโลก ฉายแบบ equirectangular ไว้แล้วในกรอบ ${W}x${H}
 *
 * ⚠️ ไฟล์นี้สร้างด้วย scripts/gen-world.mjs — อย่าแก้ด้วยมือ
 * ข้อมูลต้นทาง: world-atlas (ISC) ซึ่งแปลงจาก Natural Earth (สาธารณสมบัติ)
 * ตัดละติจูดไว้ที่ ${LAT_MAX}..${LAT_MIN} องศา (ไม่เอาแอนตาร์กติกา และตัดขั้วเหนือ
 * ส่วนที่ยืดจนผิดรูป — equirectangular ยิ่งใกล้ขั้วยิ่งยืดออกด้านข้าง)
 */
export const WORLD_W = ${W};
export const WORLD_H = ${H};

export const WORLD_PATHS: string[] = [
${paths.map((p) => `  '${p}',`).join('\n')}
];
`;

writeFileSync('src/app/lib/worldLand.ts', out);
console.log(`เขียน src/app/lib/worldLand.ts — ${paths.length} วง, ${(out.length / 1024).toFixed(1)} KB`);
