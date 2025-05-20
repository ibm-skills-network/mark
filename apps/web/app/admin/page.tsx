// app/admin/page.tsx
import AssignmentsDashboard from "@/components/admin/AssignmentDashboard";
import LoadingSpinner from "@/components/admin/Loading";
import { Suspense } from "react";

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
      <Suspense fallback={<LoadingSpinner />}>
        <AssignmentsDashboard />
      </Suspense>
    </div>
  );
}
