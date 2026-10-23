/**
 * Seed ข้อมูลตัวอย่าง: หมวดหมู่, สินค้า, ไฟล์สาธิตใน Private Storage, ภาพปก, คูปอง
 * รันซ้ำได้ (idempotent - ถ้ามีสินค้าแล้วจะข้าม)
 * ไฟล์สาธิตเป็นไฟล์จำลองเล็กๆ สำหรับทดสอบระบบดาวน์โหลด ไม่ใช่สินค้าจริง
 */
import fs from 'node:fs';
import path from 'node:path';
import { pool, q } from './pool.js';
import { config } from '../config/index.js';
import { ensureStorageDirs, productPrivateDir } from '../services/storageService.js';

// PNG 4x4 สีต่างกัน (base64) ใช้เป็นภาพปกตัวอย่าง
const PNG = {
  indigo:
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGP8//8/AwZgwhQaEqIAg/8DGRjkfEIAAAAASUVORK5CYII=',
  teal:
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGNMS0tjwABMmEJDQhQAg78Br1L4whUAAAAASUVORK5CYII=',
  rose:
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGNMS0tjwABMmEJDQhQAg78Br1L4whUAAAAASUVORK5CYII=',
};

function writeCover(name, key) {
  const dir = path.join(config.storage.publicDir, 'uploads', 'covers');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.png`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(PNG[key], 'base64'));
  return `/uploads/covers/${name}.png`;
}

function writePrivateDemoFile(productId, fileName, content) {
  const dir = productPrivateDir(productId);
  const abs = path.join(dir, fileName);
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, content, 'utf8');
  return path.relative(config.storage.privateDir, abs).split(path.sep).join('/');
}

const DEMO_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF
(Digital Marketplace demo file - seeded sample) Tj
`;

const CATEGORIES = [
  { name: 'eBook / PDF', slug: 'ebook', sort: 1, desc: 'หนังสือดิจิทัล ไฟล์ PDF' },
  { name: 'เทมเพลต', slug: 'templates', sort: 2, desc: 'เทมเพลตงานเอกสาร นำเสนอ ออกแบบ' },
  { name: 'รูปภาพ & กราฟิก', slug: 'graphics', sort: 3, desc: 'รูปภาพ ไอคอน ไฟล์กราฟิก' },
  { name: 'เสียง & วิดีโอ', slug: 'audio-video', sort: 4, desc: 'ไฟล์เสียง วิดีโอ สต็อกมีเดีย' },
  { name: 'คอร์สเรียน', slug: 'courses', sort: 5, desc: 'คอร์สเรียนและไฟล์อบรม' },
];

const PRODUCTS = [
  {
    cat: 'ebook',
    slug: 'ebook-thai-design-fundamentals',
    title: 'eBook: พื้นฐานการออกแบบสำหรับมือใหม่',
    desc: 'คู่มือ PDF ภาษาไทย 120 หน้า ครอบคลุมทฤษฎีสี องค์ประกอบศิลป์ และการจัดวางเลย์เอาต์ พร้อมไฟล์ตัวอย่างให้ฝึกทำ',
    price: '299.00',
    discount: '20.00',
    cover: 'demo-ebook',
    license: 'ซื้อครั้งเดียวใช้ส่วนตัวได้ทั้งชีวิต ห้ามนำไปขายต่อหรือแจกจ่าย',
    files: [{ name: 'ebook-design-fundamentals.txt', content: 'ตัวอย่างเนื้อหา eBook (ไฟล์สาธิตสำหรับทดสอบระบบดาวน์โหลด)\n' + '='.repeat(40) + '\nบทที่ 1: หลักการจัดวาง\n' }],
    featured: true,
  },
  {
    cat: 'templates',
    slug: 'template-presentation-modern',
    title: 'เทมเพลตพรีเซนต์ติ้ง Modern Thai (50 สไลด์)',
    desc: 'เทมเพลต Google Slides / PowerPoint ดีไซน์ทันสมัย 50 สไลด์ แก้ไขได้เต็มรูปแบบ เหมาะกับงานธุรกิจและงานนำเสนอการศึกษา',
    price: '199.00',
    discount: '0.00',
    cover: 'demo-template',
    license: 'ใช้ในงานของตัวเองได้ไม่จำกัด ห้ามแจกไฟล์ต้นฉบับ',
    files: [
      { name: 'presentation-template.txt', content: 'ไฟล์เทมเพลตตัวอย่าง (demo)\nSlideshow template placeholder\n' },
      { name: 'readme.txt', content: 'วิธีใช้งาน: คัดลอกเทมเพลตไปที่ Google Drive ของคุณ\n' },
    ],
    featured: true,
  },
  {
    cat: 'graphics',
    slug: 'graphics-icon-pack-300',
    title: 'ชุดไอคอน 300 แบบ (PNG + SVG)',
    desc: 'ไอคอนไลน์สไตล์มินิมอล 300 ไอคอน ไฟล์ PNG ความละเอียดสูงและ SVG แก้สีได้ ใช้เชิงพาณิชย์ได้',
    price: '149.00',
    discount: '10.00',
    cover: 'demo-icons',
    license: 'ใช้เชิงพาณิชย์ได้ ห้ามนำไปขายเป็นชุดไอคอนของตัวเอง',
    files: [{ name: 'icons-pack.zip.txt', content: 'icon pack demo file (ไฟล์สาธิต - ไฟล์สินค้าจริงจะเป็น .zip)\n' }],
    featured: false,
  },
  {
    cat: 'audio-video',
    slug: 'audio-lofi-bgm-pack',
    title: 'แพ็กเพลง Lofi สำหรับประกอบคลิป 10 เพลง',
    desc: 'ดนตรีประกอบคลิปวิดีโอสไตล์ Lofi 10 เพลง ใช้ใน YouTube/TikTok เชิงพาณิชย์ได้ ไม่มีค่าลิขสิทธิ์ย้อนหลัง',
    price: '399.00',
    discount: '0.00',
    cover: 'demo-audio',
    license: 'ลิขสิทธิ์ใช้ในงานวิดีโอของตนได้ ห้ามแจกจ่ายไฟล์เสียง',
    files: [{ name: 'lofi-pack-tracklist.txt', content: 'Track list (demo)\n1. Morning Coffee\n2. Rainy Window\n' }],
    featured: false,
  },
  {
    cat: 'courses',
    slug: 'course-notion-system',
    title: 'คอร์ส: จัดระเบียบชีวิตด้วย Notion (วิดีโอ + เทมเพลต)',
    desc: 'คอร์สออนไลน์ บทเรียนวิดีโอ 6 ชั่วโมง พร้อมเทมเพลต Notion ใช้จัดการงาน ตารางชีวิต และการเงินส่วนตัว',
    price: '599.00',
    discount: '15.00',
    cover: 'demo-course',
    license: 'ดูได้ไม่จำกัดเฉพาะบัญชีตัวเอง ห้ามส่งต่อ/ขายต่อ',
    files: [{ name: 'course-bonus-template.txt', content: 'Notion template link + bonus files (demo)\n' }],
    featured: true,
  },
  {
    cat: 'templates',
    slug: 'template-cv-thai-modern',
    title: 'เทมเพลตเรซูเม่ไทย 20 ดีไซน์',
    desc: 'ใบสมัครงานดีไซน์ทันสมัย 20 แบบ แก้ไขได้ใน Word/Google Docs เหมาะกับสายงานไทยและสากล',
    price: '99.00',
    discount: '0.00',
    cover: 'demo-cv',
    license: 'ใช้สมัครงานได้ไม่จำกัด ห้ามขายต่อ',
    files: [{ name: 'cv-template-pack.txt', content: 'Resume template pack (demo file)\n' }],
    featured: false,
  },
];

async function seed() {
  ensureStorageDirs();
  const existing = await q('SELECT COUNT(*) AS c FROM products');
  if (Number(existing[0].c) > 0) {
    console.log('[seed] มีข้อมูลสินค้าแล้ว -> ข้าม (ต้องการล้าง ให้รัน migrate ใหม่หรือลบ DB)');
    return;
  }

  // categories
  const catId = new Map();
  for (const c of CATEGORIES) {
    const [res] = await pool.execute(
      'INSERT INTO product_categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)',
      [c.name, c.slug, c.desc, c.sort]
    );
    catId.set(c.slug, res.insertId);
  }

  // products + files
  for (const p of PRODUCTS) {
    const [res] = await pool.execute(
      `INSERT INTO products (category_id, slug, title, description, license_terms, price,
                             discount_percent, status, featured, cover_image_url, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, NOW())`,
      [
        catId.get(p.cat),
        p.slug,
        p.title,
        p.desc,
        p.license,
        p.price,
        p.discount,
        p.featured ? 1 : 0,
        writeCover(p.cover, 'indigo'),
      ]
    );
    const pid = res.insertId;
    p.files.forEach((f, idx) => {
      const key = writePrivateDemoFile(pid, f.name, f.content);
      pool.execute(
        `INSERT INTO product_files (product_id, storage_key, original_name, mime_type, file_size, sort_order, is_primary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pid, key, f.name, 'text/plain', Buffer.byteLength(f.content, 'utf8'), idx, idx === 0 ? 1 : 0]
      );
    });
    console.log(`[seed] ✓ ${p.title}`);
  }

  // coupons
  const coupons = [
    { code: 'WELCOME10', type: 'percent', value: '10.00', min: '0.00', maxUses: null },
    { code: 'SAVE50', type: 'fixed', value: '50.00', min: '300.00', maxUses: 100 },
  ];
  for (const c of coupons) {
    await pool.execute(
      `INSERT IGNORE INTO coupons (code, type, value, min_order_amount, max_uses, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [c.code, c.type, c.value, c.min, c.maxUses]
    );
  }
  console.log('[seed] ✓ coupons: WELCOME10, SAVE50');
  console.log('[seed] เสร็จสิ้น');
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] FAILED:', err);
      process.exit(1);
    });
}
