# Clinico Systems

نظام إدارة عيادة بواجهة React عربية باتجاه RTL، وواجهة API بـ Node.js/Express، ومخطط قاعدة بيانات وترحيلات Knex. يدعم SQLite للتطوير المحلي، وMySQL 8.4 للنشر بالحاويات، وPostgreSQL (ومنها Neon) للنشر على Vercel.

## المتطلبات

- Node.js 20 أو أحدث وnpm؛ يُنصح باستخدام Node.js 22 LTS (موضح في `.nvmrc`).
- للتشغيل بحاويات الإنتاج: Docker وDocker Compose.
- لقاعدة MySQL خارج Docker: MySQL 8.x، مع قاعدة ومستخدم يملك صلاحيات إنشاء/تعديل الجداول.
- للنشر على Vercel: حساب GitHub/Vercel، وقاعدة Neon PostgreSQL مع سلسلة اتصال pooled.

## تشغيل محلي سريع

```bash
cp .env.example .env
# عدّل ADMIN_EMAIL وADMIN_PASSWORD في ملف .env الحقيقي، ولا تعدّل .env.example.
npm ci
npm run dev
```

على Windows PowerShell استخدم `Copy-Item .env.example .env` بدل أمر `cp`. يمكنك استخدام `npm install` بدل `npm ci` إذا كنت بدأت به بالفعل. عند كل تشغيل لـ `npm run dev` ينفّذ المشروع `npm run migrate` ثم `npm run seed` قبل تشغيل الواجهة والـ API؛ لن تُنشأ بيانات اعتماد من القيم النائبة في نموذج الإعداد. لإعادة التهيئة وحدها استخدم `npm run setup:local`.

افتح واجهة Vite على `http://localhost:5173`. يعمل الـ API على `http://localhost:4000`، ويُمرَّر `/api` إليه من Vite. فحص اتصال قاعدة البيانات: افتح `http://localhost:4000/api/v1/health`؛ المتوقع أن يعرض `status: ok` و`database: connected`. إذا لم يفتح، راجع رسالة API في الطرفية التي شغّلت المشروع.

التشغيل المحلي الافتراضي يستخدم ملف SQLite في `backend/data/clinico.sqlite`. المسارات النسبية لـ `DB_FILENAME` و`UPLOAD_DIR` و`BACKUP_DIR` تُحل بالنسبة إلى مجلد `backend`. ملف `.env` في جذر المشروع هو الإعداد المحلي الأساسي ويُقرأ قبل `backend/.env`.

### حسابات البداية

- يقرأ أمر `npm run seed` البريد وكلمة المرور من `ADMIN_EMAIL` و`ADMIN_PASSWORD`، وينشئ حساب مدير **مفعّلًا** إذا لم يكن موجودًا. عند الإنشاء يفرض تغيير كلمة المرور في أول دخول افتراضيًا.
- لا يحتوي المستودع على بيانات دخول افتراضية. اختر القيم بنفسك من ملف البيئة.
- إعادة تشغيل التهيئة لا تستبدل كلمة مرور المدير الموجودة ولا تعيد ضبط حالة الحساب أو إعدادات العيادة؛ استخدم وظيفة إعادة تعيين كلمة المرور للحساب عند الحاجة.
- حسابات وبيانات العرض التجريبية اختيارية فقط مع `SEED_DEMO=true` و`DEMO_PASSWORD`، وتظل معطّلة افتراضيًا. لا تفعّلها في الإنتاج.

## قاعدة MySQL

للاستخدام مع MySQL خارج Docker، أنشئ قاعدة ومستخدمًا بصلاحيات مناسبة، ثم اضبط في `.env` أو `backend/.env`:

```dotenv
DB_CLIENT=mysql2
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=clinico
DB_PASSWORD=كلمة-مرور-قاعدة-البيانات
DB_NAME=clinico
```

ثم نفّذ `npm run migrate` و`npm run seed`. ملفات الترحيل في `backend/src/db/migrations`، ويطبّق الخادم الترحيلات غير المنفذة عند بدء التشغيل.

## النشر على GitHub وVercel باستخدام Neon

أُعدّ المستودع ليُنشر كمشروع Vercel واحد: Express API على المسار نفسه، والواجهة المبنية كملفات static. إعداد `vercel.json` يشغّل `npm run vercel:build`، ويكشف فحص الصحة على `/api/v1/health`.

### 1) تهيئة Neon مرة واحدة

1. أنشئ قاعدة PostgreSQL في Neon، ومن **Connect** اختر سلسلة الاتصال **pooled**؛ يجب أن يحتوي اسم المضيف على `-pooler`. لا تضع سلسلة الاتصال في GitHub أو في محادثة عامة.
2. في نسخة محلية غير متتبعة، حدّث `.env` أو `backend/.env` بالقيم التالية (واحرص أن إعدادات `.env` الموجودة لا تستبدلها بإعداد SQLite):

   ```dotenv
   NODE_ENV=development
   DB_CLIENT=pg
   DATABASE_URL=postgresql://...pooled-neon-connection...
   TZ=Africa/Cairo
   ADMIN_EMAIL=عنوان-المدير-الحقيقي
   ADMIN_PASSWORD=كلمة-مرور-قوية-تختارها
   ADMIN_FORCE_PASSWORD_CHANGE=true
   ```

3. من جذر المشروع نفّذ مرة واحدة على قاعدة Neon الجديدة:

   ```bash
   npm ci
   npm run migrate
   npm run seed
   ```

   هذا ينشئ المخطط وحساب المدير المفعّل. أوامر التشغيل على Vercel لا تنفّذ الترحيلات أو seed تلقائيًا؛ يجب تهيئة Neon قبل أول تسجيل دخول. هذه الخطوات لا تنقل سجلات SQLite الحالية أو كلمات مرورها؛ Neon يبدأ بقاعدة جديدة. لا تستخدم `npm run db:reset` على قاعدة حقيقية.

### 2) ارفع المصدر الآمن إلى GitHub

أنشئ مستودعًا خاصًا أو عامًا، ثم من مجلد المشروع نفّذ (استبدل الرابط بعنوان مستودعك):

```bash
git init -b main
git add .
git commit -m "Prepare Clinico for Vercel and Neon"
git remote add origin <رابط-مستودع-GitHub>
git push -u origin main
```

`.gitignore` يستبعد `.env` وقاعدة SQLite والملفات المحلية ومخرجات البناء. لا ترفع كلمات مرور أو مفاتيح أو نسخة قاعدة بيانات. يوفّر `.github/workflows/ci.yml` تثبيتًا وبناءً واختبارات تلقائية عند كل push وpull request.

### 3) اربط GitHub بـ Vercel

1. استورد المستودع من Vercel واترك **Root Directory** عند جذر المستودع. يُكتشف Express عبر `index.mjs` و`vercel.json`؛ أمر البناء مضبوط في المستودع.
2. أضف المتغيرات التالية إلى Vercel لكل من **Production** وبيئة Preview التي تريد اختبارها:

   ```dotenv
   NODE_ENV=production
   DB_CLIENT=pg
   DATABASE_URL=<Neon pooled connection string>
   APP_ORIGIN=https://<نطاق-تطبيقك>
   TZ=Africa/Cairo
   FILE_STORAGE_ENABLED=false
   JWT_ACCESS_SECRET=<سر عشوائي مستقل، 64 خانة hex>
   JWT_REFRESH_SECRET=<سر عشوائي مختلف، 64 خانة hex>
   DATA_ENCRYPTION_KEY=<مفتاح عشوائي مستقل، 64 خانة hex>
   ```

   أنشئ الأسرار الثلاثة محليًا بأمر `openssl rand -hex 32` لكل قيمة على حدة، ثم أدخلها مباشرة في إعدادات Vercel. لا تحفظها في الملفات المتتبعة. `VERCEL_URL` يتولى السماح بنطاقات المعاينة تلقائيًا؛ اضبط `APP_ORIGIN` على نطاق الإنتاج النهائي.
3. بعد انتهاء النشر، اختبر `https://<نطاق-تطبيقك>/api/v1/health`؛ المتوقع `status: ok` و`database: connected`.

### تخزين الملفات على Vercel

رفع وتنزيل مرفقات الملفات الطبية متوقفان تلقائيًا على Vercel حتى يُضاف مخزن دائم؛ تخفي الواجهة اختيار الملف ويرفض الـ API مسارات `/api/v1/files`. يظل الرفع المحلي مفعّلًا افتراضيًا. أُوقفت أيضًا النسخ التي تعتمد على قرص الخادم في Vercel لأن القرص مؤقت؛ استخدم خيارات النسخ الاحتياطي الدائم من Neon. تنزيل تقارير CSV ليس من مسارات مرفقات الملفات.

لم يُرفع المستودع أو يُنشأ نشر فعلي بعد؛ ذلك يتطلب ربط حساب GitHub/Vercel الخاص بك. تفاصيل الاتصال وكلمات المرور تُضاف مباشرة إلى متغيرات البيئة في Neon/Vercel، ولا يلزم إرسالها لي.

## نشر باستخدام Docker Compose

1. انسخ `.env.example` إلى `.env` في جذر المشروع.
2. حدّث `ADMIN_EMAIL` و`ADMIN_PASSWORD` و`DB_PASSWORD` و`MYSQL_ROOT_PASSWORD`، وضع أسرارًا مستقلة قوية لمفاتيح JWT. أنشئ مفاتيح عشوائية مثلًا:

   ```bash
   openssl rand -hex 32   # كررها لقيم JWT المختلفة
   openssl rand -hex 32   # DATA_ENCRYPTION_KEY (64 خانة hex)
   ```

3. اضبط `NODE_ENV=production` و`PUBLIC_APP_ORIGIN` على أصل الموقع الفعلي دون مسار، مثل `https://clinic.example.com`. لا تعِد استخدام كلمات مرور المثال.
4. شغّل:

   ```bash
   docker compose up --build -d
   docker compose logs -f app
   ```

يبدأ MySQL 8.4 أولًا، ثم يطبّق التطبيق الترحيلات ويهيئ حساب المدير مرة واحدة قبل تشغيل API والواجهة المبنية. البيانات تبقى في وحدات Docker الدائمة `mysql_data` و`uploads` و`backups`. الموقع متاح افتراضيًا على المنفذ 4000؛ ضع reverse proxy وTLS أمامه في بيئة الإنترنت الفعلية. لا يُنشر منفذ MySQL على المضيف افتراضيًا.

لإيقاف الخدمات دون حذف البيانات: `docker compose down`. **لا تستخدم** `docker compose down -v` إلا إذا كنت تريد حذف قاعدة البيانات والملفات والنسخ الاحتياطية نهائيًا.

## التحقق والاختبارات

```bash
npm run build
npm test
```

اختبارات التكامل تستخدم قاعدة SQLite مؤقتة معزولة، وتغطي فحص الصحة وتسجيل دخول المدير والتسجيل الجديد ورفع ملف نتيجة مختبر وربطه بالمريض، ورفض إرفاق ملف يعود لمريض آخر. وتتحقق اختبارات إضافية من توليد مخطط PostgreSQL ومنع مسارات الملفات عند تعطيلها لـVercel.

## أوامر مفيدة

- `npm run dev` — يطبّق الترحيلات ويهيئ حساب المدير من `.env`، ثم يشغّل الواجهة والخادم معًا.
- `npm run setup:local` — تهيئة قاعدة التطوير المحلية فقط (`migrate` ثم `seed`).
- `npm run dev:web` / `npm run dev:api` — تشغيل أحدهما منفردًا.
- `npm run migrate` — تطبيق ترحيلات قاعدة البيانات.
- `npm run seed` — تهيئة حساب المدير والإعدادات والصلاحيات الافتراضية؛ يرفض قيم المدير النائبة.
- `npm run db:reset` — **مدمّر**: يعيد إنشاء المخطط؛ شغّل `npm run seed` بعده.
- `npm start` — تشغيل API في وضع الإنتاج؛ في الإنتاج يجب إعداد متغيرات البيئة وبناء الواجهة أولًا (`npm run build`).

## ملفات المشروع

- `frontend/` — تطبيق React وVite والواجهات.
- `backend/` — API، المصادقة، قواعد الصلاحيات، ملفات المستخدمين، وترحيلات Knex.
- `backend/src/db/migrations/` — مخطط قاعدة البيانات.
- `backend/tests/` — اختبارات API التكاملية.
- `compose.yaml` و`Dockerfile` — نشر MySQL والتطبيق بالحاويات.
