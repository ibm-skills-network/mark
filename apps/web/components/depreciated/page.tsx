import { getAssignments } from "@/lib/talkToBackend";
import Link from "next/link";

async function AuthorLayout() {
  const assignments = await getAssignments();
  return (
    <div>
      <li className="text-2xl font-bold">Assignments</li>
      <ul>
        {assignments.map((assignment) => (
          <li key={assignment.id}>
            <Link href={`/author/${assignment.id}/introduction`}>
              {assignment.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
