import FlaggedSubmissions from "@/components/admin/FlaggedComponent";

export default function FlaggedPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Flagged Submissions</h1>
      <FlaggedSubmissions />
    </div>
  );
}
