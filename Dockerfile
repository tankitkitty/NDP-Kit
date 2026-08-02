# ---------- ขั้นที่ 1: ติดตั้ง dependencies ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- ขั้นที่ 2: build (ไม่ต้องต่อฐานข้อมูล — ทุกหน้าเป็น dynamic) ----------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- ขั้นที่ 3: image สำหรับรันจริง (เล็กที่สุด) ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# ให้เวลาในระบบเป็นเวลาไทย (มีผลกับ log และการคำนวณวันที่ฝั่ง server)
RUN apk add --no-cache tzdata
ENV TZ=Asia/Bangkok

# standalone มี server.js + node_modules เท่าที่ใช้จริง
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# โฟลเดอร์เก็บค่าตั้ง (dbconfig.json, .session-secret) — mount เป็น volume จาก docker-compose
# เพื่อให้ค่าตั้งอยู่รอดข้ามการอัปเดต image
RUN mkdir -p /app/data

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
