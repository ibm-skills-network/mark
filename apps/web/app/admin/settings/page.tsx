import AdminSettings from "@/components/admin/AdminSettings";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Admin Settings</h1>
      <AdminSettings />
    </div>
  );
}
