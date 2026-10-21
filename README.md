# Chatio

Chatio là website chat nội bộ theo SRS đã chốt của nhóm, ưu tiên bảo vệ tài khoản, hội thoại, file và cơ sở dữ liệu. Phạm vi dự kiến là 50 tài khoản, khoảng 20 người dùng đồng thời; quản trị viên cấp tài khoản, không có đăng ký công khai. Giao diện được hoàn thiện sau khi chức năng và bảo mật đạt kiểm thử.

## Công nghệ

- Frontend: React, Vite, CSS thuần.
- Backend: Node.js, Express 5, Socket.IO, `pg`.
- Cơ sở dữ liệu: PostgreSQL.
- Môi trường chạy: Docker Compose.

## Cấu trúc thư mục

```text
Chatio/
├── backend/              # API và Socket.IO
├── frontend/             # React và Vite
├── docs/
│   ├── architecture/     # Sơ đồ hệ thống
│   ├── database/         # ERD và thiết kế CSDL
│   ├── srs/              # SRS đã chốt
│   └── testing/          # Test case và kết quả kiểm thử
├── compose.yaml          # Tạo ở bước 4
└── README.md
```

Các lệnh dưới đây dành cho **lần khởi tạo đầu tiên** khi `backend/` và `frontend/` còn trống. Chạy chúng trong PowerShell tại thư mục gốc `Chatio`. Nếu một thư mục đã có `package.json`, không chạy lại lệnh tạo ứng dụng trong thư mục đó.

## 1. Chuẩn bị

Cài Node.js tương thích với Vite (Node 22.12+ hoặc Node 24), Docker Desktop có Docker Compose, Git và Visual Studio Code. Kiểm tra:

```powershell
node --version
npm.cmd --version
docker compose version
```

Tạo branch riêng từ `main` trước khi khởi tạo project:

```powershell
git switch -c chore/bootstrap-stack
```

## 2. Khởi tạo backend

```powershell
Set-Location backend
npm.cmd init -y
npm.cmd install express@5 pg socket.io dotenv
npm.cmd pkg set type=module "scripts.dev=node --watch src/server.js" "scripts.start=node src/server.js"
New-Item -ItemType Directory -Force src
Set-Location ..
```

Tạo `backend/src/server.js` để kiểm tra dịch vụ đã chạy:

```js
import express from 'express';

const app = express();
app.use(express.json());
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0', () => console.log(`Backend listening on ${port}`));
```

Đây mới là endpoint kiểm tra. API tài khoản, kiểm tra quyền và Socket.IO sẽ được thêm ở các task tiếp theo.

## 3. Khởi tạo frontend

```powershell
Set-Location frontend
npm.cmd create vite@latest . -- --template react
npm.cmd install
Set-Location ..
```

Giữ các file React/Vite vừa tạo làm trang chạy thử ban đầu.

## 4. Tạo PostgreSQL và Docker Compose

Tạo file `.env` ở thư mục gốc, đặt một mật khẩu riêng đủ mạnh cho môi trường phát triển:

```dotenv
PG_ADMIN_PASSWORD=thay_bang_mat_khau_manh_cua_nhom
```

Tạo `compose.yaml` ở thư mục gốc:

```yaml
services:
  db:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_DB: chatio
      POSTGRES_PASSWORD: ${PG_ADMIN_PASSWORD:?Set PG_ADMIN_PASSWORD in .env}
    volumes:
      - postgres_data:/var/lib/postgresql
    ports:
      - '127.0.0.1:5432:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres -d chatio']
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    image: node:24-alpine
    working_dir: /app
    volumes:
      - ./backend:/app
      - backend_node_modules:/app/node_modules
    command: sh -c 'npm ci && npm run dev'
    environment:
      PORT: 3000
    ports:
      - '127.0.0.1:3000:3000'
    depends_on:
      db:
        condition: service_healthy

  frontend:
    image: node:24-alpine
    working_dir: /app
    volumes:
      - ./frontend:/app
      - frontend_node_modules:/app/node_modules
    command: sh -c 'npm ci && npm run dev -- --host 0.0.0.0'
    ports:
      - '127.0.0.1:5173:5173'
    depends_on:
      - backend

volumes:
  postgres_data:
  backend_node_modules:
  frontend_node_modules:
```

Tạo `.gitignore` ở thư mục gốc để tránh đưa file phát sinh và bí mật lên GitHub:

```gitignore
**/node_modules/
**/dist/
.env
.env.*
!.env.example
uploads/
```

Có thể tạo `.env.example` chỉ chứa tên biến và giá trị mẫu, không chứa mật khẩu thật. Mật khẩu `POSTGRES_PASSWORD` dùng để khởi tạo tài khoản quản trị PostgreSQL; backend **không được dùng tài khoản này** khi triển khai truy vấn ứng dụng. Tạo tài khoản CSDL quyền tối thiểu sau khi nhóm chốt ERD và migration.

## 5. Chạy và kiểm tra

Mở Docker Desktop, sau đó chạy ở thư mục gốc:

```powershell
docker compose config
docker compose up -d
docker compose ps
```

Kiểm tra backend tại <http://localhost:3000/api/health> (phải trả `{"status":"ok"}`) và frontend tại <http://localhost:5173/>. Xem lỗi nếu dịch vụ chưa chạy:

```powershell
docker compose logs backend
docker compose logs frontend
docker compose logs db
```

DBeaver có thể kết nối PostgreSQL khi phát triển với host `localhost`, port `5432`, database `chatio`, user `postgres` và mật khẩu trong `.env`. Dừng các dịch vụ bằng `docker compose down`; volume `postgres_data` giữ dữ liệu giữa các lần chạy. Không dùng `docker compose down -v` nếu muốn giữ dữ liệu.

## 6. Việc tiếp theo sau khi bộ khung chạy được

1. Chốt ERD, tạo migration và tài khoản CSDL chỉ có quyền cần thiết.
2. Làm đăng nhập, phiên có thể thu hồi và phân quyền trên từng API/Socket.IO.
3. Làm chat riêng, chat nhóm, lịch sử, tìm kiếm và xử lý gửi lại không trùng tin.
4. Làm file ngoài webroot, nhật ký bảo mật, mã hóa dữ liệu lưu trữ và sao lưu.
5. Kiểm thử theo SRS trước khi dùng trong mạng nội bộ.

Bộ khung ở trên phục vụ chạy thử cục bộ. Khi triển khai theo SRS, cần HTTPS, cookie an toàn, tài khoản CSDL quyền tối thiểu, kiểm tra quyền ở backend và sao lưu mã hóa.

## Quy trình nộp code

Không commit trực tiếp lên `main`. Sau khi kiểm tra bộ khung chạy được, chỉ thêm các file mã nguồn và cấu hình không chứa bí mật:

```powershell
git add README.md .gitignore compose.yaml backend frontend
git commit -m "chore: bootstrap frontend backend and compose"
git push -u origin chore/bootstrap-stack
```

Tạo Pull Request vào `main`, gửi link PR và kết quả chạy thử cho một thành viên khác kiểm tra trước khi merge.

## Tài liệu tham khảo

- [Vite Getting Started](https://vite.dev/guide/)
- [Express 5 installation](https://expressjs.com/en/guide/migrating-5/)
- [Docker Compose Quickstart](https://docs.docker.com/compose/gettingstarted/)
- [PostgreSQL Docker image](https://hub.docker.com/_/postgres)
