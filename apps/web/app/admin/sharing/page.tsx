// app/admin/sharing/page.tsx
import AssignmentSharing from '@/components/admin/AssignmentSharing';
import LoadingSpinner from '@/components/admin/Loading';
import { Suspense } from 'react';

export default function SharingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Assignment Sharing</h1>
      <Suspense fallback={<LoadingSpinner />}>
        <AssignmentSharing />
      </Suspense>
    </div>
  );
}
