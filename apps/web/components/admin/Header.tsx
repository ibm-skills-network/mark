"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  Bars3Icon,
  BellIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const pathname = usePathname();

  // Mock notifications
  const notifications = [
    {
      id: 1,
      text: "New regrading request from John Doe",
      time: "5m ago",
      read: false,
    },
    {
      id: 2,
      text: "Assignment 'Data Structures' flagged for review",
      time: "1h ago",
      read: false,
    },
    {
      id: 3,
      text: "Julia Smith completed 'Machine Learning Basics'",
      time: "2h ago",
      read: true,
    },
  ];

  // Helper to get the page title based on pathname
  const getPageTitle = () => {
    if (pathname === "/admin") return "Dashboard";
    if (pathname === "/admin/regrading") return "Regrading Requests";
    if (pathname === "/admin/flagged") return "Flagged Submissions";
    if (pathname === "/admin/analytics") return "Assignment Analytics";
    if (pathname === "/admin/settings") return "Settings";
    return "Admin";
  };

  return (
    <header className="bg-white shadow-sm z-10">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center">
          
        </div>

        <div className="hidden md:flex md:w-1/3 max-w-md">
          <div className="relative w-full">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-violet-500 focus:border-violet-500 sm:text-sm"
              placeholder="Search assignments or users..."
            />
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="relative">
            <button
              onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              className="p-1 text-gray-600 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <span className="sr-only">View notifications</span>
              <div className="relative">
                <BellIcon className="h-6 w-6" />
                {notifications.filter((n) => !n.read).length > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-red-500 text-xs font-medium text-white">
                    {notifications.filter((n) => !n.read).length}
                  </span>
                )}
              </div>
            </button>

            <AnimatePresence>
              {isNotificationsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="origin-top-right absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none"
                >
                  <div className="py-1 divide-y divide-gray-100">
                    <div className="px-4 py-2 bg-gray-50 rounded-t-md">
                      <h3 className="text-sm font-medium text-gray-700">
                        Notifications
                      </h3>
                    </div>
                    {notifications.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500">
                        No new notifications
                      </div>
                    ) : (
                      notifications.map((notification) => (
                        <div
                          key={notification.id}
                          className={`px-4 py-3 hover:bg-gray-50 ${!notification.read ? "bg-blue-50" : ""}`}
                        >
                          <p className="text-sm font-medium text-gray-800">
                            {notification.text}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {notification.time}
                          </p>
                        </div>
                      ))
                    )}
                    <div className="px-4 py-2 bg-gray-50 rounded-b-md">
                      <Link
                        href="/admin/notifications"
                        className="text-xs font-medium text-violet-600 hover:text-violet-800"
                      >
                        View all notifications
                      </Link>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative">
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <span className="sr-only">Open user menu</span>
              <div className="h-8 w-8 rounded-full bg-violet-200 flex items-center justify-center text-violet-800 font-semibold">
                AD
              </div>
            </button>

            <AnimatePresence>
              {isProfileOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none"
                >
                  <div className="py-1">
                    <a
                      href="#"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Your Profile
                    </a>
                    <a
                      href="#"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Settings
                    </a>
                    <a
                      href="#"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Sign out
                    </a>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white border-t"
          >
            <div className="px-2 pt-2 pb-3 space-y-1">
              <Link
                href="/admin"
                className={`block px-3 py-2 rounded-md text-base font-medium ${pathname === "/admin" ? "text-violet-800 bg-violet-100" : "text-gray-700 hover:bg-gray-50"}`}
              >
                Dashboard
              </Link>
              <Link
                href="/admin/regrading"
                className={`block px-3 py-2 rounded-md text-base font-medium ${pathname === "/admin/regrading" ? "text-violet-800 bg-violet-100" : "text-gray-700 hover:bg-gray-50"}`}
              >
                Regrading Requests
              </Link>
              <Link
                href="/admin/flagged"
                className={`block px-3 py-2 rounded-md text-base font-medium ${pathname === "/admin/flagged" ? "text-violet-800 bg-violet-100" : "text-gray-700 hover:bg-gray-50"}`}
              >
                Flagged Submissions
              </Link>
              <Link
                href="/admin/analytics"
                className={`block px-3 py-2 rounded-md text-base font-medium ${pathname === "/admin/analytics" ? "text-violet-800 bg-violet-100" : "text-gray-700 hover:bg-gray-50"}`}
              >
                Analytics
              </Link>
              <Link
                href="/admin/settings"
                className={`block px-3 py-2 rounded-md text-base font-medium ${pathname === "/admin/settings" ? "text-violet-800 bg-violet-100" : "text-gray-700 hover:bg-gray-50"}`}
              >
                Settings
              </Link>
            </div>
            <div className="pt-4 pb-3 border-t border-gray-200">
              <div className="px-3 space-y-1">
                <a
                  href="#"
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-50"
                >
                  Your Profile
                </a>
                <a
                  href="#"
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-50"
                >
                  Settings
                </a>
                <a
                  href="#"
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-50"
                >
                  Sign out
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
