"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  HomeIcon,
  ClipboardDocumentCheckIcon,
  FlagIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ArrowLeftOnRectangleIcon,
} from "@heroicons/react/24/outline";

const navItems = [
  { name: "Dashboard", href: "/admin", icon: HomeIcon },
  {
    name: "Regrading",
    href: "/admin/regrading",
    icon: ClipboardDocumentCheckIcon,
  },
  { name: "Flagged Submissions", href: "/admin/flagged", icon: FlagIcon },
  { name: "Analytics", href: "/admin/analytics", icon: ChartBarIcon },
  { name: "Settings", href: "/admin/settings", icon: Cog6ToothIcon },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <motion.div
      initial={{ x: -280 }}
      animate={{ x: 0 }}
      transition={{ duration: 0.3 }}
      className="w-64 bg-white shadow-md z-20 h-full hidden md:block"
    >
      <div className="p-4">
        <div className="flex items-center justify-center p-2 mb-6">
          <h1 className="text-xl font-bold text-violet-800">
            Assignment Admin
          </h1>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`group flex items-center px-4 py-3 rounded-md transition-all ${
                  isActive
                    ? "bg-violet-100 text-violet-800"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <item.icon
                  className={`mr-3 h-5 w-5 ${
                    isActive ? "text-violet-600" : "text-gray-500"
                  }`}
                />
                <span className="font-medium">{item.name}</span>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    className="absolute left-0 w-1 h-8 bg-violet-600 rounded-r-md"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="absolute bottom-0 w-full p-4">
        <Link
          href="/"
          className="flex items-center px-4 py-3 text-gray-600 hover:bg-gray-50 rounded-md transition-all"
        >
          <ArrowLeftOnRectangleIcon className="mr-3 h-5 w-5 text-gray-500" />
          <span className="font-medium">Logout</span>
        </Link>
      </div>
    </motion.div>
  );
}
