import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AppProvider } from "./context/AppContext";
import { AppToaster } from "./components/AppToaster";
import { ProtectedRoute } from "./routes/ProtectedRoute";
// AppShell แทน DashboardLayout เดิม (sidebar + bottom tabs) ตามดีไซน์ใหม่ที่ใช้ top nav เดียว
import { AppShell } from "./layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { QueuePage } from "./pages/QueuePage";
import { CallLogPage } from "./pages/CallLogPage";
import { SystemPage } from "./pages/SystemPage";
import { ContactsPage } from "./pages/ContactsPage";
import { SetupPage } from "./pages/SetupPage";
import { DeviceConfigPage } from "./pages/DeviceConfigPage";
import { ApiGuidePage } from "./pages/ApiGuidePage";

export default function App() {
  return (
    <AppProvider>
      <AppToaster />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/overview" element={<DashboardPage />} />
              <Route path="/queue" element={<QueuePage />} />
              <Route path="/history" element={<CallLogPage />} />
              <Route path="/system" element={<SystemPage />} />
              <Route path="/settings" element={<Navigate to="/system" replace />} />
              <Route path="/contacts" element={<ContactsPage />} />
              {/* 2 path นี้เป็นหน้าเดียวกัน (SetupPage) ต่างกันแค่แท็บที่เปิดอยู่
              เก็บทั้งคู่ไว้เพราะลิงก์เดิมที่เคยแชร์/บุ๊กมาร์กไว้ต้องยังใช้ได้ */}
              <Route path="/event-types" element={<SetupPage />} />
              {/* /api-keys เปลี่ยนเป็น /devices ตามดีไซน์ (1 key = 1 อุปกรณ์)
                  redirect ไว้เผื่อมี bookmark เดิม */}
              <Route path="/devices" element={<SetupPage />} />
              <Route path="/devices/:id" element={<DeviceConfigPage />} />
              <Route path="/api-keys" element={<Navigate to="/devices" replace />} />
              <Route path="/api-guide" element={<ApiGuidePage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
