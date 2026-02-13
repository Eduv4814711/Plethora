"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";

interface Shift {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  employee: { id: string; firstName: string; lastName: string };
  post: { name: string; site: { name: string } };
}

const statusColors: Record<string, string> = {
  created: "bg-slate-100 text-slate-700",
  assigned: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  completed: "bg-slate-100 text-slate-600",
  verified: "bg-green-100 text-green-700",
};

export default function RosteringPage() {
  const { token } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<{ id: string; firstName: string; lastName: string; status?: string }[]>([]);
  const [sites, setSites] = useState<{ id: string; name: string; posts: { id: string; name: string }[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!token) return;
    const start = new Date();
    start.setDate(1);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    Promise.all([
      authFetch(
        `/shifts?startDate=${start.toISOString()}&endDate=${end.toISOString()}`,
        token
      ).then((r) => r.json()),
      authFetch("/employees?limit=100", token).then((r) => r.json()),
      authFetch("/sites?limit=100", token).then((r) => r.json()),
    ])
      .then(([shiftsRes, empRes, sitesRes]) => {
        setShifts(shiftsRes.data || []);
        setEmployees(empRes.data || []);
        setSites(sitesRes.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  const refresh = () => {
    if (!token) return;
    const start = new Date();
    start.setDate(1);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    authFetch(
      `/shifts?startDate=${start.toISOString()}&endDate=${end.toISOString()}`,
      token
    )
      .then((r) => r.json())
      .then((d) => setShifts(d.data || []));
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-48 mb-4" />
        <div className="h-96 bg-slate-200 dark:bg-slate-700 rounded" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
          Rostering
        </h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          {showForm ? "Cancel" : "Add Shift"}
        </button>
      </div>

      {showForm && (
        <ShiftForm
          token={token!}
          employees={employees}
          sites={sites}
          onSuccess={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}

      <div className="space-y-3">
        {shifts.map((shift) => (
          <div
            key={shift.id}
            className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between"
          >
            <div>
              <span className="font-medium">
                {shift.employee.firstName} {shift.employee.lastName}
              </span>
              <span className="text-slate-500 mx-2">at</span>
              <span>
                {shift.post.site.name} - {shift.post.name}
              </span>
              <span
                className={`ml-2 inline-block px-2 py-0.5 rounded text-xs ${
                  statusColors[shift.status] || "bg-slate-100"
                }`}
              >
                {shift.status}
              </span>
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {new Date(shift.startTime).toLocaleString()} -{" "}
              {new Date(shift.endTime).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {shifts.length === 0 && (
        <p className="text-slate-500 py-8 text-center">No shifts scheduled</p>
      )}
    </div>
  );
}

function ShiftForm({
  token,
  employees,
  sites,
  onSuccess,
}: {
  token: string;
  employees: { id: string; firstName: string; lastName: string; status?: string }[];
  sites: { id: string; name: string; posts: { id: string; name: string }[] }[];
  onSuccess: () => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [postId, setPostId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState("");

  const posts = sites.flatMap((s) =>
    s.posts.map((p) => ({ ...p, siteName: s.name }))
  );

  const activeEmployees = employees.filter((e) => e.status === "active");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await authFetch("/shifts", token, {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          postId,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          status: "assigned",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create shift");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
    >
      <h3 className="font-medium mb-4">New Shift</h3>
      {error && (
        <div className="mb-4 p-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          required
          className="px-3 py-2 border rounded dark:bg-slate-700 dark:border-slate-600"
        >
          <option value="">Select employee</option>
          {activeEmployees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.firstName} {e.lastName}
            </option>
          ))}
        </select>
        <select
          value={postId}
          onChange={(e) => setPostId(e.target.value)}
          required
          className="px-3 py-2 border rounded dark:bg-slate-700 dark:border-slate-600"
        >
          <option value="">Select post</option>
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.siteName} - {p.name}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
          className="px-3 py-2 border rounded dark:bg-slate-700 dark:border-slate-600"
        />
        <input
          type="datetime-local"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          required
          className="px-3 py-2 border rounded dark:bg-slate-700 dark:border-slate-600"
        />
      </div>
      <button
        type="submit"
        className="mt-4 px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
      >
        Create Shift
      </button>
    </form>
  );
}
