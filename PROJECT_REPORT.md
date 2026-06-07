# تقرير شامل عن مشروع LUMÉRA Beauty - متجر إلكتروني متقدم

**تاريخ التقرير:** يونيو 2026  
**إصدار المشروع:** 1.0.0  
**نوع المشروع:** متجر إلكتروني متكامل (Front-End + Back-End + Admin Dashboard)

---

## 1. نظرة عامة عن المشروع

### الهدف الرئيسي:
مشروع متجر إلكتروني متقدم متخصص في بيع منتجات التجميل والعناية الشخصية (ماركة LUMÉRA Beauty). يوفر تجربة تسوق فاخرة وحديثة مع لوحة إدارة قوية للتحكم الكامل بالمتجر.

### المميزات الرئيسية:
- **واجهة متجر عصرية وفاخرة** بتصميم RTL (اتجاه من اليمين إلى اليسار) للغة العربية
- **سلة تسوق متقدمة** مع حساب الخصومات والشحن التلقائي
- **نظام كوبونات متقدم** مع تتبع الاستخدام والصلاحيات
- **لوحة إدارة شاملة** مع تحليلات وإحصائيات باستخدام Chart.js
- **نظام مستخدمين بأدوار مختلفة** (Super Admin, Store Manager, Employee, Support Agent)
- **إدارة منتجات وتصنيفات** مع رفع الصور
- **نظام طلبات متقدم** مع تتبع الحالة والملاحظات
- **نظام توصيل متعدد المناطق** (الضفة الغربية، القدس، الداخل 48)
- **دعم اللغة العربية بالكامل** مع تصميم RTL

---

## 2. التكنولوجيا المستخدمة

### Frontend:
- **HTML5** - للبنية الأساسية
- **CSS3** - للتصميم والتنسيق (مع دعم RTL)
- **Vanilla JavaScript** - منطق العميل بدون أي إطار عمل
- **Chart.js** - لرسم المخططات والإحصائيات
- **Lucide Icons** - أيقونات SVG عصرية
- **Font: Cairo** - خط عربي جميل من Google Fonts

### Backend:
- **Node.js** - بيئة التشغيل
- **Express.js (v5.2.1)** - إطار عمل ويب
- **Multer (v2.1.1)** - لمعالجة رفع الملفات
- **CORS** - للتعامل مع طلبات Cross-Origin
- **dotenv** - لإدارة المتغيرات البيئية
- **Puppeteer (v23.11.1)** - لتوليد ملفات PDF (اختياري)

### التخزين:
- **JSON Files** - قاعدة بيانات بسيطة وفعالة
  - `data/products.json` - قائمة المنتجات
  - `data/categories.json` - التصنيفات
  - `data/users.json` - حسابات المستخدمين
  - `data/orders.json` - الطلبات
  - `data/coupons.json` - الكوبونات/الخصومات
  - `data/settings.json` - إعدادات المتجر

### البنية الأساسية:
```
arabic-store/
├── index.html              # صفحة المتجر الرئيسية
├── admin.html              # صفحة لوحة الإدارة
├── login.html              # صفحة تسجيل الدخول
├── print-order.html        # طباعة الطلبات
│
├── app.js                  # منطق المتجر الأمامي
├── admin.js                # منطق لوحة الإدارة
├── api.js                  # واجهة API للعميل
├── auth.js                 # نظام المصادقة والأدوار
├── server.js               # خادم Express الرئيسي
│
├── styles.css              # أنماط المتجر الرئيسية
├── admin.css               # أنماط لوحة الإدارة
├── package.json            # اعتماديات المشروع
│
├── data/                   # ملفات البيانات (JSON)
│   ├── products.json       # المنتجات
│   ├── categories.json     # التصنيفات
│   ├── users.json          # المستخدمون
│   ├── orders.json         # الطلبات
│   ├── coupons.json        # الكوبونات
│   └── settings.json       # الإعدادات
│
├── images/                 # ملفات الصور
│   ├── products/           # صور المنتجات
│   ├── branding/           # صور العلامة التجارية
│   └── categories/         # صور التصنيفات
│
├── themes/                 # ملفات التصاميم البديلة
│   ├── calm.css            # تصميم هادئ (افتراضي)
│   ├── modern.css          # تصميم عصري
│   ├── luxury.css          # تصميم فاخر
│   ├── minimal.css         # تصميم بسيط
│   └── signature.css       # تصميم توقيع
│
├── public/                 # ملفات عامة ثابتة
├── backend/                # مشروع Backend منفصل (اختياري)
└── start-store.bat        # سكريبت لتشغيل المتجر

```

---

## 3. نظام المصادقة والمستخدمين (Authentication & RBAC)

### الأدوار المتاحة:
```javascript
ROLES = {
  super_admin:   { label: 'مدير عام', color: '#6C3CE1' },
  store_manager: { label: 'مدير المتجر', color: '#0284c7' },
  employee:      { label: 'موظف', color: '#059669' },
  support_agent: { label: 'دعم فني', color: '#eab308' }
}
```

### الصلاحيات حسب الدور:
```javascript
PERMISSIONS = {
  super_admin:   ['manage_users', 'manage_products', 'manage_categories', 'manage_orders', 'manage_settings', 'manage_media', 'view_orders', 'update_orders', 'add_products', 'add_order_notes', 'manage_customers'],
  store_manager: ['manage_products', 'manage_categories', 'manage_orders', 'manage_media', 'manage_customers', 'view_orders', 'update_orders', 'add_products', 'add_order_notes'],
  employee:      ['view_orders', 'update_orders', 'add_products'],
  support_agent: ['view_orders', 'add_order_notes']
}
```

### المستخدمون الحاليون:
| Username | Name | Email | Role | Password | Status |
|----------|------|-------|------|----------|--------|
| admin | نورالدين | admin@loulo.sa | super_admin | admin123 | نشط |
| owner | ايناس | owner@loulo.sa | store_manager | enas123 | نشط |
| manager | محمد | manager@loulo.sa | store_manager | manager123 | نشط |
| support | سارة | support@loulo.sa | employee | support123 | نشط |

### آلية المصادقة:
- تسجيل الدخول عبر **username أو email** مع كلمة مرور
- حفظ الجلسة في `sessionStorage` (تُحذف عند إغلاق التاب)
- التحقق من الصلاحيات قبل الوصول للصفحات
- إعادة توجيه تلقائية لصفحة تسجيل الدخول عند انقضاء الجلسة

---

## 4. إعدادات المتجر (Store Configuration)

### المعلومات الأساسية:
```javascript
{
  "id": "loulo-beauty",
  "name": "LUMÉRA Beauty",
  "subtitle": "جمالك يبدأ من التفاصيل",
  "country": "PS",
  "currency": "ILS",
  "currencySymbol": "₪",
  "theme": "minimal"
}
```

### معلومات التواصل:
- **الهاتف:** 0599775099
- **البريد الإلكتروني:** support@lumera-beauty.com
- **واتساب:** 970599775099
- **العنوان:** نابلس، فلسطين

### الألوان والتصميم:
- **اللون الرئيسي:** #311B92 (بنفسجي)
- **اللون الثانوي:** #F48FB1 (وردي)
- **لون النص:** #ff0080
- **لون النص الفرعي:** #475569

### الصور والعلامة التجارية:
- **الشعار:** `/images/branding/1779566276356-Firefly.jpg`
- **Favicon:** `/images/branding/1779566292788-AseYa.jpg`
- **بانرات البطل:** `/images/branding/1779570029478-WlWZ3.jpg`
- **بانرات العروض:** `/images/branding/1779560641182-GMEJp.jpg`

### النصوص الديناميكية:
- **Hero Title:** "اكتشفي عالم الجمال الفاخر"
- **Hero Highlight:** "LUMÉRA"
- **Promo Text:** نص العروض الحالية
- **About Text:** نص صفحة من نحن
- **Privacy Text:** سياسة الخصوصية
- **Terms Text:** شروط الاستخدام

### بوابات الدفع:
```javascript
paymentGateways: {
  cod: true,      // الدفع عند الاستلام ✓
  visa: true,     // بطاقات ائتمانية ✓
  gateway: "stripe",
  publicKey: "",
  secretKey: ""
}
```

---

## 5. المنتجات والتصنيفات

### التصنيفات المتاحة:
| ID | Name | Image |
|----|------|-------|
| all | الكل | - |
| face | العناية بالوجه | ✓ |
| perfume | العطور | ✓ |
| makeup | المكياج | ✓ |
| hair | العناية بالشعر | ✓ |

### عينة من المنتجات الحالية:
```javascript
{
  "id": 1,
  "name": "كريم مضيء للوجه - سيروم ذهبي",
  "category": "face",
  "price": 89,
  "oldPrice": 120,
  "rating": 4.8,
  "reviews": 124,
  "badge": "جديد",
  "stock": 50,
  "active": true,
  "description": "سيروم ذهبي فاخر يمنح البشرة توهجاً مثالياً...",
  "image": "/images/products/1779562131354-mQwWN.jpg",
  "bg": "linear-gradient(135deg,#FFF9E6,#FFE9B0)"
}
```

### خصائص المنتج:
- `id` - معرف فريد
- `name` - اسم المنتج
- `category` - التصنيف
- `price` - السعر الحالي
- `oldPrice` - السعر السابق (للعروض)
- `rating` - التقييم (0-5)
- `reviews` - عدد التقييمات
- `badge` - شارة (جديد/تخفيض)
- `stock` - الكمية المتوفرة
- `active` - هل المنتج نشط
- `description` - وصف المنتج
- `image` - رابط الصورة
- `bg` - خلفية Gradient

---

## 6. نظام الطلبات

### حالات الطلب:
- `pending` - قيد الانتظار
- `confirmed` - مؤكد
- `preparing` - جاري التجهيز
- `shipped` - تم الشحن
- `delivered` - تم التوصيل
- `cancelled` - ملغى

### مثال على طلب:
```javascript
{
  "id": "ORD-001",
  "customer": "نورالدين",
  "phone": "0599775099",
  "address": "رفيديا / شارع الحاووز",
  "zone": "arab48",
  "zoneName": "الداخل arab 48",
  "items": [
    {
      "name": "أحمر شفاه مطفي - ماتي لاكس",
      "qty": 1,
      "price": 45
    }
  ],
  "subtotal": 211,
  "shipping": 80,
  "discount": 0,
  "couponCode": "",
  "total": 291,
  "status": "pending",
  "paymentMethod": "cod",
  "date": "2026-05-24",
  "notes": [],
  "internalComments": [],
  "statusHistory": []
}
```

### مناطق التوصيل ورسوم الشحن:
| Zone ID | Zone Name | Shipping Fee |
|---------|-----------|--------------|
| westbank | الضفة العربية | ₪25 |
| jerusalem | القدس | ₪35 |
| arab48 | الداخل arab 48 | ₪80 |

---

## 7. نظام الكوبونات/الخصومات

### الكوبونات الحالية:
```javascript
[
  {
    "code": "WELCOME10",
    "discountPercent": 10,
    "maxUses": -1,           // غير محدود
    "usedCount": 0,
    "active": true,
    "expiryDate": "2026-12-31"
  },
  {
    "code": "SUMMER20",
    "discountPercent": 20,
    "maxUses": 100,          // محدود 100 استخدام
    "usedCount": 15,
    "active": true,
    "expiryDate": "2026-08-31"
  }
]
```

### آلية تطبيق الكوبون:
1. المستخدم يدخل كود الكوبون في سلة التسوق
2. يتم التحقق من صحة الكود والتاريخ والعدد المتبقي
3. يتم حساب الخصم تلقائياً (discount = subtotal * percent / 100)
4. يُعرض المجموع النهائي = subtotal - discount + shipping
5. يتم حفظ بيانات الكوبون مع الطلب

---

## 8. التصاميم/الثيمات (Themes)

المشروع يدعم تبديل التصاميم الديناميكي:

| Theme | File | Description |
|-------|------|-------------|
| calm | themes/calm.css | تصميم هادئ (افتراضي) |
| modern | themes/modern.css | تصميم عصري |
| luxury | themes/luxury.css | تصميم فاخر |
| minimal | themes/minimal.css | تصميم بسيط |
| signature | themes/signature.css | تصميم توقيع |

تبديل التصميم عبر:
```javascript
setThemeStylesheet('calm');  // تغيير الثيم
```

---

## 9. واجهة API (API Endpoints)

### المنتجات:
- `GET /api/products` - جلب جميع المنتجات
- `GET /api/products/:id` - جلب منتج واحد
- `POST /api/products` - إضافة منتج جديد
- `PUT /api/products/:id` - تحديث منتج
- `DELETE /api/products/:id` - حذف منتج

### التصنيفات:
- `GET /api/categories` - جلب التصنيفات
- `POST /api/categories` - إضافة تصنيف
- `PUT /api/categories/:id` - تحديث تصنيف
- `DELETE /api/categories/:id` - حذف تصنيف

### الطلبات:
- `GET /api/orders` - جلب جميع الطلبات
- `POST /api/orders` - إنشاء طلب جديد
- `PUT /api/orders/:id` - تحديث حالة الطلب
- `DELETE /api/orders/:id` - حذف طلب

### الكوبونات:
- `GET /api/coupons` - جلب الكوبونات
- `POST /api/coupons/validate` - التحقق من كوبون
- `POST /api/coupons` - إضافة كوبون جديد
- `PUT /api/coupons/:code` - تحديث كوبون
- `DELETE /api/coupons/:code` - حذف كوبون

### المستخدمين:
- `GET /api/users` - جلب المستخدمين
- `POST /api/users` - إضافة مستخدم
- `PUT /api/users/:id` - تحديث مستخدم
- `DELETE /api/users/:id` - حذف مستخدم

### الإعدادات:
- `GET /api/settings` - جلب إعدادات المتجر
- `PUT /api/settings/:id` - تحديث الإعدادات
- `GET /api/countries` - جلب قائمة الدول
- `GET /api/countries/:code` - جلب بيانات دولة

### رفع الملفات:
- `POST /api/upload` - رفع صورة منتج
- `POST /api/upload/branding` - رفع صورة علامة تجارية

---

## 10. لوحة الإدارة (Admin Dashboard)

### الصفحات الرئيسية:
1. **Dashboard (لوحة المعلومات)**
   - إحصائيات سريعة (الطلبات، الإيرادات، المنتجات، العملاء)
   - رسوم بيانية باستخدام Chart.js
   - آخر الطلبات والمنتجات الجديدة

2. **Products (إدارة المنتجات)**
   - عرض جميع المنتجات في جدول
   - إضافة/تعديل/حذف منتج
   - رفع صور
   - تعيين الفئة والسعر والمراجعات

3. **Categories (التصنيفات)**
   - إدارة تصنيفات المنتجات
   - رفع صور للتصنيفات
   - تنظيم المنتجات حسب الفئات

4. **Orders (إدارة الطلبات)**
   - عرض جميع الطلبات
   - تحديث حالة الطلب
   - عرض التفاصيل الكاملة
   - إضافة ملاحظات داخلية
   - طباعة الطلب

5. **Users (إدارة المستخدمين)**
   - عرض جميع المستخدمين
   - إضافة/تعديل حساب
   - تعيين الأدوار والصلاحيات
   - تفعيل/تعطيل الحسابات

6. **Coupons (إدارة الكوبونات)**
   - عرض الكوبونات النشطة
   - إضافة كوبون جديد
   - تحديث النسبة والصلاحية
   - تتبع عدد الاستخدامات

7. **Settings (الإعدادات)**
   - البيانات الأساسية (الاسم، الوصف)
   - الألوان والتصميم
   - معلومات التواصل
   - إعدادات الدول والعملات
   - النصوص الديناميكية
   - بوابات الدفع
   - الصور والعلامة التجارية

---

## 11. ميزات المتجر الأمامي (Storefront)

### الصفحات:
1. **Home** - الصفحة الرئيسية مع البانر والفئات والمنتجات
2. **Categories** - عرض المنتجات حسب الفئة
3. **Product Details** - معلومات المنتج التفصيلية
4. **Search** - البحث عن المنتجات
5. **Cart** - سلة التسوق مع حساب الإجمالي
6. **Checkout** - خطوات الدفع والتوصيل
7. **Order Confirmation** - تأكيد الطلب

### ميزات السلة:
- إضافة/إزالة المنتجات
- تعديل الكمية
- تطبيق كوبون خصم
- اختيار منطقة التوصيل
- حساب الشحن تلقائياً
- عرض المجموع النهائي

### الخروج (Checkout):
- إدخال بيانات المستقبل
- اختيار طريقة الدفع (COD أو Visa)
- مراجعة الطلب
- إنشاء الطلب والتأكيد

---

## 12. الملفات الرئيسية وشرح كل ملف

### `server.js` - خادم Express الرئيسي
- إعداد الخادم والـ CORS
- معالجة الملفات الثابتة
- نقاط النهاية (Endpoints) للـ API
- قراءة/كتابة البيانات في JSON

### `app.js` - منطق المتجر
- تحميل المنتجات والتصنيفات
- إدارة السلة
- معالجة البحث والتصفية
- حفظ الطلبات
- حساب الخصومات والشحن

### `admin.js` - منطق لوحة الإدارة
- التحكم في المنتجات والتصنيفات
- إدارة الطلبات والمستخدمين
- إدارة الكوبونات
- الإحصائيات والرسوم البيانية
- تحديث الإعدادات

### `api.js` - واجهة API للعميل
- دوال جلب البيانات من الخادم
- إدارة الجلسات والأدوار
- معالجة الأخطاء والإعادة
- رفع الملفات

### `auth.js` - نظام المصادقة
- تسجيل الدخول والخروج
- إدارة الجلسات
- التحقق من الصلاحيات
- معلومات الأدوار والألوان

### `styles.css` - التصاميم الأساسية
- تصميم المتجر الأمامي
- سلة التسوق
- الاستجابة للأجهزة المختلفة
- دعم RTL للعربية

### `admin.css` - تصاميس لوحة الإدارة
- تصميم الواجهة الإدارية
- الجداول والنماذج
- النمط الفاخر والحديث

---

## 13. البيانات والنماذج (Data Models)

### Product Model:
```javascript
{
  id: number,
  name: string,
  category: string,
  price: number,
  oldPrice: number | null,
  rating: number (0-5),
  reviews: number,
  badge: string | null,
  stock: number,
  active: boolean,
  description: string,
  image: string (URL),
  bg: string (gradient),
  createdAt: string
}
```

### Order Model:
```javascript
{
  id: string,
  customer: string,
  phone: string,
  address: string,
  zone: string,
  items: Array,
  subtotal: number,
  shipping: number,
  discount: number,
  couponCode: string,
  total: number,
  status: string,
  paymentMethod: string,
  date: string,
  notes: Array,
  internalComments: Array
}
```

### User Model:
```javascript
{
  id: string,
  username: string,
  name: string,
  email: string,
  password: string,
  role: string,
  active: boolean,
  createdAt: string
}
```

### Coupon Model:
```javascript
{
  code: string,
  discountPercent: number,
  maxUses: number (-1 = unlimited),
  usedCount: number,
  active: boolean,
  expiryDate: string
}
```

---

## 14. الأمان والملاحظات

### نقاط الأمان:
- **عدم حفظ كلمات المرور في الجلسات** - يتم حفظ بيانات أخرى فقط
- **التحقق من الصلاحيات** - في كل عملية حساسة
- **CORS** - للتحكم في الطلبات من النطاقات الخارجية
- **معالجة الأخطاء** - لعدم الكشف عن معلومات حساسة

### النقاط التي تحتاج تحسين:
- **كلمات المرور** - يجب تشفيرها (bcrypt) وليس حفظها بصيغة نصية
- **قاعدة بيانات** - الانتقال من JSON إلى MongoDB/PostgreSQL للمتاجر الكبيرة
- **التحقق من رسائل البريد** - التحقق من صحة البريد الإلكتروني
- **SSL/HTTPS** - استخدام شهادات SSL في الإنتاج
- **معدل الطلبات** - تحديد عدد الطلبات في الثانية (Rate Limiting)

---

## 15. التعليمات والأوامر

### تشغيل المشروع:
```bash
# تثبيت الاعتماديات
npm install

# تشغيل الخادم
npm start
# أو
node server.js
```

### فتح المتجر:
- متجر العميل: `http://localhost:3000` أو `http://localhost:3000/index.html`
- لوحة الإدارة: `http://localhost:3000/admin.html`
- تسجيل الدخول: `http://localhost:3000/login.html`

### حسابات الاختبار:
| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | Super Admin |
| owner | enas123 | Store Manager |
| manager | manager123 | Store Manager |
| support | support123 | Employee |

---

## 16. الملفات والمجلدات الهامة

```
📦 arabic-store
├── 📄 index.html                  ← صفحة المتجر الرئيسية
├── 📄 admin.html                  ← لوحة الإدارة
├── 📄 login.html                  ← صفحة تسجيل الدخول
├── 📄 print-order.html            ← طباعة الطلبات
│
├── 🔨 app.js                      ← منطق المتجر
├── 🔨 admin.js                    ← منطق لوحة الإدارة
├── 🔨 api.js                      ← واجهة API
├── 🔨 auth.js                     ← نظام المصادقة
├── 🔨 server.js                   ← خادم Express
│
├── 🎨 styles.css                  ← تصاميس المتجر
├── 🎨 admin.css                   ← تصاميس لوحة الإدارة
│
├── 📊 data/
│   ├── products.json              ← المنتجات
│   ├── categories.json            ← التصنيفات
│   ├── users.json                 ← المستخدمون
│   ├── orders.json                ← الطلبات
│   ├── coupons.json               ← الكوبونات
│   └── settings.json              ← إعدادات المتجر
│
├── 🖼️ images/
│   ├── products/                  ← صور المنتجات
│   ├── branding/                  ← شعار وبانرات
│   └── categories/                ← صور التصنيفات
│
├── 🎭 themes/                     ← التصاميم البديلة
│   ├── calm.css
│   ├── modern.css
│   ├── luxury.css
│   ├── minimal.css
│   └── signature.css
│
└── 📦 package.json               ← الاعتماديات
```

---

## 17. ملاحظات إضافية

### القيود الحالية:
1. البيانات تُحفظ في JSON (غير فعالة للمتاجر الكبيرة)
2. كلمات المرور بدون تشفير
3. لا يوجد نظام بريد إلكتروني للتنبيهات
4. الدفع عبر البطاقات (Stripe) غير مفعل حالياً

### الإمكانيات المستقبلية:
- [ ] نظام إشعارات بريدية
- [ ] تقييمات وتعليقات المستخدمين
- [ ] برنامج الولاء والعملاء الدائمين
- [ ] تطبيق جوال
- [ ] دعم لغات إضافية
- [ ] تحليلات متقدمة
- [ ] نظام توصيات المنتجات (AI)
- [ ] سوق للبائعين

---

## 18. الاتصال والدعم

**الموقع:** www.lumera-beauty.com (في الإنشاء)  
**البريد:** support@lumera-beauty.com  
**الهاتف:** 0599775099  
**واتساب:** 970599775099

---

**انتهى التقرير الشامل**

*آخر تحديث: يونيو 2026*
