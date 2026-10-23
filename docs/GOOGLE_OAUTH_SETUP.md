# ตั้งค่า Google OAuth

คู่มือสร้าง OAuth Client เพื่อเปิดใช้งาน "เข้าสู่ระบบด้วย Google"

> Backend ยืนยันตัวตนกับ Google **โดยตรง** (server-to-server) — จึงไม่มี
> Client Secret ในฝั่ง Frontend เลย

## 1. สร้างโปรเจกต์ใน Google Cloud Console

1. เปิด [Google Cloud Console](https://console.cloud.google.com/)
2. เลือก/สร้างโปรเจกต์ใหม่ (top-left dropdown → **New Project**)

## 2. ตั้ง OAuth consent screen

1. ไปที่ **APIs & Services → OAuth consent screen**
2. ตั้งค่า:
   - **User type:** `External` (เพื่อให้บัญชี Google ทั่วไปใช้ได้)
   - ใส่ชื่อแอป, อีเมลผู้ติดต่อ, โดเมน (ถ้ามี)
3. ไปที่ **Scopes** → เพิ่ม:
   - `email`
   - `profile`
   - `openid`
4. (แนะนำ) เพิ่ม **Test users** ด้วยอีเมลของคุณระหว่างพัฒนา เพื่อไม่ให้ต้อง verify แอป

## 3. สร้าง OAuth client ID

1. ไปที่ **Credentials → Create Credentials → OAuth client ID**
2. เลือก **Application type:** `Web application`
3. ตั้งชื่อ (เช่น "ดิจิสโตร์ Web")
4. เพิ่ม **Authorized redirect URIs** ให้ครบ:
   - `http://localhost:4000/api/auth/google/callback`   ← สำหรับ Local (dev)
   - `https://<โดเมน-production>/api/auth/google/callback`  ← สำหรับ Production

   > ต้องตรงเป๊ะทั้ง scheme (http/https), โฮสต์, พอร์ต และ path

5. กด **Create** → คัดลอก **Client ID** และ **Client Secret**

## 4. ตั้งค่าใน `.env`

```env
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
# อีเมลที่ได้สิทธิ์ admin อัตโนมัติเมื่อ login
ADMIN_EMAILS=admin@example.com
```

รีสตาร์ท Backend หลังแก้ `.env`

## 5. ทดสอบ

1. เปิด `http://localhost:5173/login` — ปุ่ม "เข้าสู่ระบบด้วย Google" ต้อง **ไม่ disabled**
   (ถ้ายังขึ้น "ยังไม่ได้ตั้งค่า Google OAuth" แสดงว่า Client ID/Secret ยังไม่เข้า)
2. คลิกปุ่ม → ตกลง permissions → ระบบ redirect กลับมาพร้อม session
3. เช็ค `GET /api/auth/me` ต้องคืนโปรไฟล์ผู้ใช้

## 6. พฤติกรรมที่ Backend บังคับ

- ผู้ใช้ต้อง **ยืนยันอีเมลจาก Google แล้ว** เท่านั้น (`email_verified`) จึง login ได้
- บัญชีถูก **ระงับ** (`status=suspended`) จะเข้าสู่ระบบไม่ได้
- **session regeneration** ทุกครั้งที่ login สำเร็จ (ป้องกัน session fixation)
- Email ถูกใช้ระบุ/ผูกบัญชี — หากอีเมลซ้ำจะเข้าสู่บัญชีเดิม (upsert)

## 7. สำหรับ Production

- เพิ่ม redirect URI ของโดเมนจริง (HTTPS) ใน OAuth client
- หากขึ้นสถานะ "แอปยังไม่ผ่านการตรวจสอบ" ให้เพิ่มอีเมลตัวเองเป็น test user
  หรือยื่น verify แอปเมื่อพร้อมเปิดให้บัญชีทั่วไปใช้
- อย่า commit Client Secret ลงระบบ version control

## 8. การแก้ปัญหา

| อาการ | สาเหตุที่เป็นไปได้ |
|-------|-------------------|
| ปุ่ม Login disabled | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` ยังไม่ถูกตั้ง/อ่านไม่ได้ |
| redirect_uri_mismatch | URI ใน Google Console ไม่ตรงกับ `GOOGLE_CALLBACK_URL` |
| login ไม่สำเร็จกลับมา `error=state_mismatch` | state ไม่ตรง (session ถูกรีเซ็ตระหว่างทาง) — ลอง login ใหม่ |
| `error=email_not_verified` | อีเมล Google ยังไม่ได้ยืนยัน |
| `error=suspended` | บัญชีถูกระงับในระบบ (admin ต้องเปิดสถานะ) |
