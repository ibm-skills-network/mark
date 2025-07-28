import { BellIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { motion } from "framer-motion";

export const NotificationsPanel = ({
  notifications,
  onClose,
  onMarkRead,
  onClickNotification,
}: {
  notifications: Array<{
    id: number;
    title: string;
    message: string;
    createdAt: string;
    read: boolean;
  }>;
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onClickNotification: (notification: {
    id: number;
    title: string;
    message: string;
    createdAt: string;
    read: boolean;
  }) => void;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="px-4 py-3 mb-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm max-h-[60vh] overflow-y-auto"
    >
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
          <BellIcon className="w-4 h-4 mr-2" />
          Notifications
        </h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        {notifications.length === 0 ? (
          <div className="text-center py-4 text-gray-500 dark:text-gray-400">
            No notifications
          </div>
        ) : (
          notifications.map((notification) => (
            <div
              key={notification.id}
              onClick={() => onClickNotification(notification)}
              className={`p-3 rounded-md cursor-pointer transition-colors ${
                notification.read
                  ? "bg-gray-50 dark:bg-gray-900"
                  : "bg-purple-50 dark:bg-purple-900/30 border-l-4 border-purple-500 dark:border-purple-400"
              } hover:bg-gray-100 dark:hover:bg-gray-800`}
            >
              <div className="flex justify-between">
                <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {notification.title}
                </h4>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(notification.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                {notification.message}
              </p>
              {!notification.read && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkRead(notification.id);
                  }}
                  className="text-xs text-purple-600 dark:text-purple-400 mt-2 hover:underline"
                >
                  Mark as read
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
};
