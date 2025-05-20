// components/admin/AdminSettings.tsx
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Switch } from "@headlessui/react";
import {
  Cog6ToothIcon,
  BellAlertIcon,
  DocumentTextIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

export default function AdminSettings() {
  // Notification settings
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [slackNotifications, setSlackNotifications] = useState(false);
  const [desktopNotifications, setDesktopNotifications] = useState(true);

  // Integrity settings
  const [enablePlagiarismDetection, setEnablePlagiarismDetection] =
    useState(true);
  const [enableTimeAnomalyDetection, setEnableTimeAnomalyDetection] =
    useState(true);
  const [enableAiDetection, setEnableAiDetection] = useState(true);
  const [flagThreshold, setFlagThreshold] = useState(75);

  // Access settings
  const [defaultAssignmentAccess, setDefaultAssignmentAccess] = useState<
    "public" | "private"
  >("private");
  const [requireLinkVerification, setRequireLinkVerification] = useState(false);
  const [linkExpirationDays, setLinkExpirationDays] = useState(30);

  // System settings
  const [enableExperimental, setEnableExperimental] = useState(false);
  const [enableDebugMode, setEnableDebugMode] = useState(false);
  const [dataRetentionDays, setDataRetentionDays] = useState(365);

  const handleSaveSettings = () => {
    // Here we would typically save settings to the server
    alert("Settings saved successfully!");
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden"
      >
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
          <div className="flex items-center">
            <BellAlertIcon className="h-5 w-5 text-gray-500 mr-2" />
            <h2 className="text-lg font-medium text-gray-900">
              Notification Settings
            </h2>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Email Notifications
              </h3>
              <p className="text-sm text-gray-500">
                Receive email alerts for regrading requests and flagged
                submissions
              </p>
            </div>
            <Switch
              checked={emailNotifications}
              onChange={setEmailNotifications}
              className={`${
                emailNotifications ? "bg-violet-600" : "bg-gray-200"
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  emailNotifications ? "translate-x-6" : "translate-x-1"
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Slack Notifications
              </h3>
              <p className="text-sm text-gray-500">
                Receive Slack alerts for important events
              </p>
            </div>
            <Switch
              checked={slackNotifications}
              onChange={setSlackNotifications}
              className={`${
                slackNotifications ? "bg-violet-600" : "bg-gray-200"
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  slackNotifications ? "translate-x-6" : "translate-x-1"
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Desktop Notifications
              </h3>
              <p className="text-sm text-gray-500">
                Receive browser notifications when viewing the dashboard
              </p>
            </div>
            <Switch
              checked={desktopNotifications}
              onChange={setDesktopNotifications}
              className={`${
                desktopNotifications ? "bg-violet-600" : "bg-gray-200"
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  desktopNotifications ? "translate-x-6" : "translate-x-1"
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden"
      >
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
          <div className="flex items-center">
            <ShieldCheckIcon className="h-5 w-5 text-gray-500 mr-2" />
            <h2 className="text-lg font-medium text-gray-900">
              Academic Integrity Settings
            </h2>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Plagiarism Detection
              </h3>
              <p className="text-sm text-gray-500">
                Automatically check submissions for plagiarism
              </p>
            </div>
            <Switch
              checked={enablePlagiarismDetection}
              onChange={setEnablePlagiarismDetection}
              className={`${
                enablePlagiarismDetection ? "bg-violet-600" : "bg-gray-200"
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  enablePlagiarismDetection ? "translate-x-6" : "translate-x-1"
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Time Anomaly Detection
              </h3>
              <p className="text-sm text-gray-500">
                Flag suspiciously fast completion times
              </p>
            </div>
            <Switch
              checked={enableTimeAnomalyDetection}
              onChange={setEnableTimeAnomalyDetection}
              className={`${
                enableTimeAnomalyDetection ? "bg-violet-600" : "bg-gray-200"
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  enableTimeAnomalyDetection ? "translate-x-6" : "translate-x-1"
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                AI-Generated Content Detection
              </h3>
              <p className="text-sm text-gray-500">
                Flag submissions that appear to be AI-generated
              </p>
            </div>
            <Switch
              checked={enableAiDetection}
              onChange={setEnableAiDetection}
              className={`${
                enableAiDetection ? "bg-violet-600" : "bg-gray-200"
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  enableAiDetection ? "translate-x-6" : "translate-x-1"
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <label
              htmlFor="flag-threshold"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Flag Threshold (%)
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="range"
                id="flag-threshold"
                min="50"
                max="100"
                value={flagThreshold}
                onChange={(e) => setFlagThreshold(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-sm font-medium text-gray-900 w-10 text-right">
                {flagThreshold}%
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Higher values mean fewer false positives but might miss some cases
            </p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden"
      >
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
          <div className="flex items-center">
            <UserGroupIcon className="h-5 w-5 text-gray-500 mr-2" />
            <h2 className="text-lg font-medium text-gray-900">
              Access Settings
            </h2>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-900">
              Default Assignment Access
            </label>
            <div className="mt-2 flex space-x-4">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  className="form-radio text-violet-600 focus:ring-violet-500"
                  name="defaultAccess"
                  checked={defaultAssignmentAccess === "private"}
                  onChange={() => setDefaultAssignmentAccess("private")}
                />
                <span className="ml-2 text-sm text-gray-700">
                  Private (requires secure link)
                </span>
              </label>
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  className="form-radio text-violet-600 focus:ring-violet-500"
                  name="defaultAccess"
                  checked={defaultAssignmentAccess === "public"}
                  onChange={() => setDefaultAssignmentAccess("public")}
                />
                <span className="ml-2 text-sm text-gray-700">
                  Public (accessible to anyone with link)
                </span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Require Link Verification
              </h3>
              <p className="text-sm text-gray-500">
                Learners must verify their identity before accessing assignments
              </p>
            </div>
            <Switch
              checked={requireLinkVerification}
              onChange={setRequireLinkVerification}
              className={`${
                requireLinkVerification ? "bg-violet-600" : "bg-gray-200"
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  requireLinkVerification ? "translate-x-6" : "translate-x-1"
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <label
                htmlFor="expiration-days"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Secure Link Expiration (days)
              </label>
              <input
                type="number"
                id="expiration-days"
                min="1"
                max="365"
                value={linkExpirationDays}
                onChange={(e) =>
                  setLinkExpirationDays(parseInt(e.target.value))
                }
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm"
              />
            </div>
            <div className="flex items-center">
              <ClockIcon className="h-5 w-5 text-gray-400" />
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
        className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden"
      >
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
          <div className="flex items-center">
            <Cog6ToothIcon className="h-5 w-5 text-gray-500 mr-2" />
            <h2 className="text-lg font-medium text-gray-900">
              System Settings
            </h2>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Enable Experimental Features
              </h3>
              <p className="text-sm text-gray-500">
                Try out new beta features before they are fully released
              </p>
            </div>
            <Switch
              checked={enableExperimental}
              onChange={setEnableExperimental}
              className={`${
                enableExperimental ? "bg-violet-600" : "bg-gray-200"
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  enableExperimental ? "translate-x-6" : "translate-x-1"
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Debug Mode</h3>
              <p className="text-sm text-gray-500">
                Show detailed error messages and logging information
              </p>
            </div>
            <Switch
              checked={enableDebugMode}
              onChange={setEnableDebugMode}
              className={`${
                enableDebugMode ? "bg-violet-600" : "bg-gray-200"
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  enableDebugMode ? "translate-x-6" : "translate-x-1"
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <label
                htmlFor="data-retention"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Data Retention Period (days)
              </label>
              <input
                type="number"
                id="data-retention"
                min="30"
                max="3650"
                value={dataRetentionDays}
                onChange={(e) => setDataRetentionDays(parseInt(e.target.value))}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm"
              />
            </div>
            <div className="flex items-center">
              <DocumentTextIcon className="h-5 w-5 text-gray-400" />
            </div>
          </div>

          <button
            type="button"
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
          >
            <ArrowPathIcon className="h-4 w-4 mr-2" />
            Reset to Defaults
          </button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.4 }}
        className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden"
      >
        <div className="p-5">
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            Advanced Options
          </h2>

          <div className="space-y-2">
            <a
              href="#"
              className="flex items-center justify-between p-3 rounded-md hover:bg-gray-50"
            >
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  User Management
                </h3>
                <p className="text-sm text-gray-500">
                  Manage authors and learners
                </p>
              </div>
              <ChevronRightIcon className="h-5 w-5 text-gray-400" />
            </a>

            <a
              href="#"
              className="flex items-center justify-between p-3 rounded-md hover:bg-gray-50"
            >
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  API Credentials
                </h3>
                <p className="text-sm text-gray-500">
                  Manage API keys and webhooks
                </p>
              </div>
              <ChevronRightIcon className="h-5 w-5 text-gray-400" />
            </a>

            <a
              href="#"
              className="flex items-center justify-between p-3 rounded-md hover:bg-gray-50"
            >
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  Export Data
                </h3>
                <p className="text-sm text-gray-500">
                  Download assignment and submission data
                </p>
              </div>
              <ChevronRightIcon className="h-5 w-5 text-gray-400" />
            </a>

            <a
              href="#"
              className="flex items-center justify-between p-3 rounded-md hover:bg-gray-50"
            >
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  System Logs
                </h3>
                <p className="text-sm text-gray-500">
                  View system logs and error reports
                </p>
              </div>
              <ChevronRightIcon className="h-5 w-5 text-gray-400" />
            </a>
          </div>
        </div>
      </motion.div>

      <div className="flex justify-end space-x-4 pt-4">
        <button
          type="button"
          className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSaveSettings}
          className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
        >
          Save Settings
        </button>
      </div>
    </div>
  );
}
