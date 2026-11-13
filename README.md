# TWO SOULS — Don't Get Separated

เกมต้นแบบ Horror Co-op ออนไลน์ 2 คน รองรับ Browser บน PC และมือถือ

## ต้องติดตั้ง
- Node.js 18 ขึ้นไป
- อินเทอร์เน็ตสำหรับโหลด Three.js และ Google Fonts จาก CDN

## วิธีเปิดบนคอม
1. แตกไฟล์ ZIP
2. เปิด Terminal / Command Prompt ในโฟลเดอร์โปรเจกต์
3. รัน `npm install`
4. รัน `npm start`
5. เปิด `http://localhost:3000`

## วิธีทดสอบ 2 คนในเครือข่ายเดียวกัน
- เครื่องแรกเปิดเกมและกด “สร้างห้องใหม่”
- ส่ง Room Code ให้ผู้เล่นอีกคน
- เครื่องที่สองเปิด `http://IP-ของเครื่องแรก:3000` แล้วกรอกรหัสห้อง

## เล่นออนไลน์ผ่านอินเทอร์เน็ต
ต้องนำโปรเจกต์นี้ไป Deploy บน Node.js hosting ที่รองรับ WebSocket เช่น Render, Railway หรือ VPS
- ตั้ง Build/Install command: `npm install`
- ตั้ง Start command: `npm start`
- เปิด URL HTTPS ที่โฮสต์ให้ทั้งสองคน
- ผู้เล่นคนแรกสร้างห้องและส่งรหัสให้คนที่สอง

## Controls
PC:
- WASD / Arrow keys = เดิน
- คลิกในเกมเพื่อจับเมาส์ แล้วขยับเมาส์เพื่อหมุนมุมมอง
- E = เก็บฟิวส์
- C = สลับ First / Third Person

Mobile:
- วงกลมด้านซ้าย = เดิน
- ปุ่มเก็บของ = เก็บฟิวส์
- ปุ่มด้านล่าง = สลับกล้องและไฟฉาย

## สถานะต้นแบบ / สิ่งที่ต้องพัฒนาต่อ
- มีระบบห้อง 2 คนและซิงก์ตำแหน่งผู้เล่นผ่าน Socket.IO
- มีฉาก 3D สร้างจาก geometry, ฟิวส์ 3 ชิ้น, ไฟฉาย, ประตูหนี และศัตรูไล่ตามแบบ client-side
- ยังไม่ใช่เกม Production: ยังไม่มีระบบบัญชี, matchmaking, anti-cheat, server-authoritative monster/physics, ระบบ revive/จับผู้เล่นจริง, เสียง/animation, หรือระบบ reconnect/resume
- แนะนำให้เพิ่ม HTTPS, rate limiting, room expiry, input validation และ authoritative game state ก่อนเปิดให้คนทั่วไปใช้
