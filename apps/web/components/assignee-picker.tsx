"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { listTaskAssignees, type AssigneeOption } from "@/lib/api";

interface AssigneePickerProps {
  value: { type: "user" | "employee" | null; id: string | null };
  onChange: (value: { type: "user" | "employee" | null; id: string | null }) => void;
  className?: string;
  placeholder?: string;
}

export function AssigneePicker({
  value,
  onChange,
  className = "input-compact",
  placeholder = "Assign to...",
}: AssigneePickerProps) {
  const { token } = useAuth();
  const [users, setUsers] = useState<AssigneeOption[]>([]);
  const [employees, setEmployees] = useState<AssigneeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"user" | "employee">("user");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token || !open) return;
    setLoading(true);
    listTaskAssignees(token)
      .then(({ users: u, employees: e }) => {
        setUsers(u);
        setEmployees(e);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const allOptions = [...users, ...employees];
  const selected = value.id
    ? allOptions.find((o) => o.type === value.type && o.id === value.id)
    : null;
  const displayValue = selected ? `${selected.displayName} (${selected.subtitle})` : "";

  const filteredOptions = tab === "user" ? users : employees;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full text-left ${className} flex items-center justify-between`}
      >
        <span className={!displayValue ? "text-gray-500" : ""}>
          {displayValue || placeholder}
        </span>
        <svg
          className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[240px] rounded-lg border border-gray-300 bg-white shadow-lg">
          <div className="flex border-b border-gray-200">
            <button
              type="button"
              onClick={() => setTab("user")}
              className={`flex-1 px-3 py-2 text-sm font-medium ${
                tab === "user" ? "bg-gray-100 text-black border-b-2 border-security-navy-200" : "text-gray-600"
              }`}
            >
              Users
            </button>
            <button
              type="button"
              onClick={() => setTab("employee")}
              className={`flex-1 px-3 py-2 text-sm font-medium ${
                tab === "employee" ? "bg-gray-100 text-black border-b-2 border-security-navy-200" : "text-gray-600"
              }`}
            >
              Employees
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {loading ? (
              <p className="p-3 text-sm text-gray-500">Loading...</p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ type: null, id: null });
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded"
                >
                  Unassigned
                </button>
                {filteredOptions.map((o) => (
                  <button
                    key={`${o.type}-${o.id}`}
                    type="button"
                    onClick={() => {
                      onChange({ type: o.type, id: o.id });
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded ${
                      value.type === o.type && value.id === o.id ? "bg-gray-100 font-medium" : ""
                    }`}
                  >
                    <div>{o.displayName}</div>
                    {o.subtitle && (
                      <div className="text-xs text-gray-500">{o.subtitle}</div>
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
