/**
 * استيراد ملف أرشفة Excel إلى قاعدة بيانات التطبيق — يُشغَّل مرة واحدة فقط.
 *
 * طريقة الاستخدام:
 *   1) ضع ملف "ارشفة2024.xlsx" في نفس مجلد الباك إند (جانب server.js)
 *   2) شغّل الباك إند: node server.js
 *   3) في نافذة طرفية ثانية، شغّل: node import-archive.js
 *
 * يقرأ الشيت "Feuil1"، يأخذ العمودين:
 *   - العمود A: اسم السيد(ة) ورقم الاختيار  → search_key (التصميم+الكود)
 *   - العمود B: اسم ملف التخزين              → storage_file (اسم العميل)
 * ويرسلهم على دفعات إلى /api/archive/import حتى لا يثقل الذاكرة.
 */
import xlsx from "xlsx";
import path from "path";

const API_URL = process.env.API_URL || "http://localhost:3001/api";
const FILE_NAME = process.argv[2] || "ارشفة2024.xlsx";
const SHEET_NAME = "Feuil1";
const BATCH_SIZE = 500;
const MAX_RETRIES = 3;

async function sendBatch(batch, attempt = 1) {
  const res = await fetch(`${API_URL}/archive/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: batch }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Server returned HTML (error page) instead of JSON
    if (attempt < MAX_RETRIES) {
      console.warn(`  ⚠️  رد غير صالح من الخادم، إعادة المحاولة (${attempt}/${MAX_RETRIES})...`);
      await new Promise((r) => setTimeout(r, 800));
      return sendBatch(batch, attempt + 1);
    }
    console.error("  ❌ رد الخادم (أول 300 حرف):", text.slice(0, 300));
    throw new Error(`فشل بعد ${MAX_RETRIES} محاولات`);
  }

  if (!data.success && attempt < MAX_RETRIES) {
    console.warn(`  ⚠️  ${data.message || "فشل"}، إعادة المحاولة (${attempt}/${MAX_RETRIES})...`);
    await new Promise((r) => setTimeout(r, 800));
    return sendBatch(batch, attempt + 1);
  }

  return data;
}

async function main() {
  const filePath = path.resolve(FILE_NAME);
  console.log(`📂 قراءة الملف: ${filePath}`);

  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    console.error(`❌ لم يتم العثور على الشيت "${SHEET_NAME}"`);
    process.exit(1);
  }

  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  // الصف الأول هو العناوين — نتجاوزه
  const dataRows = rows.slice(1);

  const cleaned = [];
  for (const r of dataRows) {
    const searchKey = String(r[0] ?? "").trim();
    const storageFile = String(r[1] ?? "").trim();
    if (!searchKey) continue;
    cleaned.push({ search_key: searchKey, storage_file: storageFile });
  }

  console.log(`📦 إجمالي السجلات الصالحة: ${cleaned.length}`);
  console.log(`🚀 إرسال على دفعات من ${BATCH_SIZE}...`);

  let imported = 0;
  let failedBatches = 0;
  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const batch = cleaned.slice(i, i + BATCH_SIZE);
    try {
      const data = await sendBatch(batch);
      if (!data.success) {
        console.error(`  ❌ فشلت الدفعة عند السطر ${i}: ${data.message}`);
        failedBatches++;
        continue;
      }
      imported += batch.length;
      console.log(`  ✅ ${imported}/${cleaned.length} — الإجمالي في القاعدة: ${data.total}`);
    } catch (err) {
      console.error(`  ❌ فشلت الدفعة عند السطر ${i}:`, err.message);
      failedBatches++;
    }
  }

  if (failedBatches > 0) {
    console.log(`⚠️  انتهى الاستيراد مع ${failedBatches} دفعة فاشلة. شغّل السكريبت مرة ثانية — الدفعات الناجحة لن تتكرر بشكل خاطئ.`);
  } else {
    console.log("🎉 تم استيراد الأرشيف بنجاح!");
  }
}

main().catch((err) => {
  console.error("❌ خطأ:", err);
  process.exit(1);
});