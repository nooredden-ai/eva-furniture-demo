# Restaurant Suite — Stable Demo Release v1.8

## معلومات الإصدار

- **Version:** v1.8-restaurant-suite-stable-demo
- **Branch:** feature/restaurant-ops-v1.2
- **Commit:** 3d763d2
- **Tag:** v1.8-restaurant-suite-stable-demo
- **Release Type:** Stable Demo Release
- **Status:** QA Passed / Demo Ready

## ملخص الإصدار

هذا الإصدار يثبت نسخة ديمو مستقرة لمنصة Restaurant Suite بعد اكتمال:

- Table Menu QR
- Open Order Flow
- POS
- Tables
- Kitchen Screen
- Customer Display
- Admin Home
- Auth
- Order Status Flow
- Printing basic checks
- QA Audit

## أهم ما تم تثبيته

### 1. Table Menu QR

- فتح منيو الطاولة عبر رابط `table-menu.html` مع `table` + `token`
- تحميل المنتجات والتصنيفات
- إنشاء طلب من QR
- دعم الطلب المفتوح
- إضافة أصناف إلى طلب مفتوح
- إصلاح مشكلة scroll وآخر صف

### 2. POS

- واجهة تشغيلية محسّنة
- إضافة منتجات للسلة
- اختيار الطاولة
- دعم إرسال الطلب للمطبخ
- دعم إضافة للطلب المفتوح

### 3. Tables

- عرض الطاولات
- فتح POS للطاولة
- فتح QR الصحيح عبر `table-menu.html`
- روابط QR مبنية على `qrToken` الحقيقي

### 4. Kitchen

- عرض الطلبات
- تغيير الحالة
- إخفاء الأسعار
- دعم Badge إضافة جديدة
- دعم الطباعة والتنبيه

### 5. Customer Display

- شاشة TV داكنة Premium
- عرض الطلبات قيد التحضير والجاهزة
- عدم عرض بيانات شخصية أو أسعار

### 6. Admin Home

- تبسيط الصفحة الرئيسية
- إضافة Hero + Ops Center + KPIs
- روابط مباشرة إلى POS / Tables / Kitchen / Customer Display

### 7. QA Verification

الفحص أكد:

- السيرفر مستقر
- login/auth يعمل
- إنشاء طلب من Table Menu يعمل
- الطلب يظهر في Kitchen
- تغيير الحالة يعمل
- Customer Display يستجيب
- الصفحات الأساسية ترجع 200
- لا توجد تغييرات كود بعد الفحص
- `data` فقط قد تتغير محليًا بسبب الطلبات التجريبية وتبقى غير staged

## ملاحظات تشغيلية

- هذا الإصدار مناسب للديمو والعرض على أصحاب المطاعم.
- ملفات `data` المحلية قد تكون dirty بسبب اختبارات QA ولا يجب إضافتها للـ commit.
- أي تطوير جديد يجب أن يبدأ من مرحلة جديدة بعد هذا tag.

## Known Notes

- Product ID 1 inactive في بيانات الديمو، وهذا ليس خطأ كود.
- Console browser الحقيقي يفضّل فحصه دوريًا قبل أي عرض مباشر.
- Customer Display مناسب أكثر عند العرض Full Screen.

## Next Suggested Phases

- Phase 22B — Demo Data Cleanup / Seed Reset
- Phase 22C — Public Demo Preparation
- Phase 23A — Next Feature Planning
