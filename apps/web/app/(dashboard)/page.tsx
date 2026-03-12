"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

interface DashboardData {
  guardsOnDuty: number;
  guardsOnDutyByDay?: { name: string; value: number }[];
  activeSitesCount: number;
  payrollStatus: Record<string, number>;
  alerts: { type: string; message: string; count?: number }[];
  taskStats?: { overdue: number; dueToday: number };
  shiftsOverTime?: { name: string; value: number }[];
  employeesByStatus?: { name: string; value: number }[];
}

const defaultGuardsByDay = [
  { name: "Mon", value: 30 },
  { name: "Tue", value: 32 },
  { name: "Wed", value: 28 },
  { name: "Thu", value: 35 },
  { name: "Fri", value: 38 },
  { name: "Sat", value: 42 },
  { name: "Sun", value: 25 },
];

const rosteredData = [
  { name: "Item 1", value: 52.5 },
  { name: "Item 2", value: 29.5 },
  { name: "Item 3", value: 18 },
];

const defaultStatusData = [{ name: "No data", value: 1 }];

const defaultShiftData = [
  { name: "Jan", value: 0 },
  { name: "Feb", value: 0 },
  { name: "Mar", value: 0 },
  { name: "Apr", value: 0 },
];

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#f97316"]; // Blue, purple, orange

export default function DashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    authFetch("/dashboard", token)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-9 w-48 bg-gray-200 rounded-lg border border-gray-300" />
        <div className="grid grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 bg-gray-200 rounded-lg border border-gray-300" />
          ))}
        </div>
      </div>
    );
  }

  const DashboardCard = ({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) => (
    <div className={`bg-gray-100 border border-gray-300 rounded-lg flex flex-col p-4 relative ${className}`}>
      {title && (
        <h2 className="font-bold text-sm text-black mb-4">{title}</h2>
      )}
      <div className="flex-1 w-full h-full relative">{children}</div>
    </div>
  );

  return (
    <div className="animate-fade-in max-w-7xl mx-auto py-2">
      <h1 className="text-2xl font-bold text-black mb-6">Dashboard</h1>

      <div className="flex gap-6">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col gap-6">
          {/* Top Row */}
          <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-6 h-64">
            <DashboardCard title="Guards On Duty">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.guardsOnDutyByDay ?? defaultGuardsByDay} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="0" vertical={false} stroke="#9ca3af" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fill: "#374151", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#374151", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", stroke: "#3b82f6", strokeWidth: 2, r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </DashboardCard>

            <DashboardCard title="Active Sites">
              <div className="flex items-center justify-center h-full">
                <span className="text-7xl font-bold text-black">{data?.activeSitesCount ?? 69}</span>
              </div>
            </DashboardCard>

            <DashboardCard title="Active Guards Rostered">
              <div className="absolute inset-0 flex items-center justify-center pt-8">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={rosteredData}
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius={70}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, value }) => `${name} ${value}`}
                    >
                      {rosteredData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </DashboardCard>
          </div>

          {/* Bottom Row */}
          <div className="grid grid-cols-[1fr_1.5fr_1fr] gap-6 h-64">
            <DashboardCard title="TEAM MEMBER BY STATUS">
              <div className="absolute inset-0 flex items-center justify-center pt-8">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={(() => {
                        const raw = data?.employeesByStatus ?? [];
                        return raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                      })()}
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius={70}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, value }) => `${name} ${value}`}
                    >
                      {(() => {
                        const raw = data?.employeesByStatus ?? [];
                        const chartData = raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                        return chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ));
                      })()}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </DashboardCard>

            <DashboardCard title="SHIFT SCHEDULED OVER TIME">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data?.shiftsOverTime?.length ? data.shiftsOverTime : defaultShiftData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  barSize={40}
                >
                  <CartesianGrid strokeDasharray="0" vertical={false} stroke="#9ca3af" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fill: "#374151", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#374151", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </DashboardCard>

            <DashboardCard title="Payroll Status" className="flex flex-col gap-3 justify-center">
              <div className="flex flex-col gap-3">
                <button className="w-full bg-black text-white py-3 px-4 text-center font-bold text-sm uppercase rounded">
                  DRAFT: {data?.payrollStatus?.draft ?? 0}
                </button>
                <button className="w-full bg-black text-white py-3 px-4 text-center font-bold text-sm uppercase rounded">
                  CALC: {data?.payrollStatus?.calculated ?? 0}
                </button>
                <button className="w-full bg-black text-white py-3 px-4 text-center font-bold text-sm uppercase rounded">
                  PAID: {data?.payrollStatus?.paid ?? 0}
                </button>
              </div>
            </DashboardCard>
          </div>
        </div>

        {/* Right Sidebar - Tasks Widget */}
        <div className="w-56 flex-shrink-0">
          <div className="bg-gray-100 border border-gray-300 rounded-lg w-full p-4">
            <h2 className="font-bold text-sm text-black mb-3">My Tasks</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Overdue</span>
                <span className="font-semibold text-red-600">
                  {data?.taskStats?.overdue ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Due today</span>
                <span className="font-semibold text-black">
                  {data?.taskStats?.dueToday ?? 0}
                </span>
              </div>
            </div>
            <Link
              href="/tasks"
              className="mt-4 block w-full text-center btn-secondary text-sm py-2"
            >
              View Tasks
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
