# วิธีนำ TWO SOULS ขึ้นออนไลน์ด้วย Render (ภาษาไทย)

## เตรียมไฟล์
1. แตกไฟล์ ZIP
2. เข้าโฟลเดอร์ `two_souls_horror`
3. ตรวจว่ามี `package.json`, `server.js`, `render.yaml`, `public/`

## อัปโหลดขึ้น GitHub
1. สมัคร/เข้าสู่ระบบ GitHub: https://github.com
2. สร้าง repository ใหม่ชื่อ `two-souls-horror`
3. ตั้งเป็น Private ได้ (แนะนำ) แล้วกด Create repository
4. ในหน้า repository เลือก `Add file` > `Upload files`
5. เปิดโฟลเดอร์ `two_souls_horror` ในคอม แล้วลากไฟล์และโฟลเดอร์ด้านในทั้งหมดขึ้น GitHub (อย่าลากโฟลเดอร์ชั้นนอกซ้อนอีกชั้น)
6. กด `Commit changes`

## สร้าง Web Service บน Render
1. เข้า https://render.com แล้วสมัคร/เข้าสู่ระบบ
2. กด `New` > `Web Service`
3. เชื่อมบัญชี GitHub และเลือก repository `two-souls-horror`
4. ตั้งค่า:
   - Name: `two-souls-horror` (หรือชื่อที่ยังว่าง)
   - Runtime: `Node`
   - Branch: `main`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: `Free` สำหรับทดลอง
5. กด `Create Web Service` และรอจนสถานะเป็น `Live`
6. เปิด URL `https://ชื่อบริการ.onrender.com`

## วิธีเล่น
- ผู้เล่นคนแรกเปิด URL แล้วกดสร้างห้อง
- ส่ง Room Code ให้ผู้เล่นคนที่สอง
- ผู้เล่นคนที่สองเปิด URL เดียวกันบน Safari (iPhone) หรือ Chrome แล้วกรอกรหัส
- ผู้สร้างห้องกดเริ่มเกม

## ข้อควรรู้
- Render Free อาจหยุดบริการเมื่อไม่มี traffic 15 นาที และการเปิดครั้งแรกหลังหยุดอาจใช้เวลาประมาณหนึ่งนาที
- WebSocket รองรับบน Render Web Services; Socket.IO ใช้การเชื่อมต่อแบบ real-time
- Free instance เหมาะสำหรับทดสอบ ไม่เหมาะกับ production และบริการอาจ restart ได้
- ห้องและสถานะผู้เล่นเก็บในหน่วยความจำของ server; เมื่อบริการ restart/deploy ห้องทั้งหมดจะหาย ต้องสร้างห้องใหม่
- โค้ดเกมนี้ยังเป็น prototype: ยังไม่มี anti-cheat, reconnect/resume, authoritative server-side enemy simulation, revive จริง หรือระบบบัญชี
- ไม่ต้องตั้งค่า PORT เอง; แอปอ่าน `process.env.PORT` อยู่แล้ว
