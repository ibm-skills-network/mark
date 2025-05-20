// components/admin/ShareAssignmentModal.tsx
"use client";

import { useState, Fragment, useEffect } from 'react';
import { Dialog, Transition, Switch } from '@headlessui/react';
import { XMarkIcon, DocumentDuplicateIcon, LinkIcon, LockClosedIcon, LockOpenIcon, QrCodeIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { Assignment } from '@/config/types';
import QRCode from "react-qr-code";
import { useAdminStore } from '@/stores/admin';

interface ShareAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: Assignment;
}

export default function ShareAssignmentModal({ 
  isOpen, 
  onClose, 
  assignment 
}: ShareAssignmentModalProps) {
  const [shareLink, setShareLink] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [showLtiCode, setShowLtiCode] = useState(false);
  const { updateAssignment } = useAdminStore();

  useEffect(() => {
    // Set initial share status based on assignment
    setIsPublic(assignment.published || false);
    
    // Generate a base share link
    generateShareLink(assignment.published || false);
  }, [assignment]);

  const generateShareLink = (isPublicStatus: boolean) => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    
    if (isPublicStatus) {
      // Public URL format
      setShareLink(`${baseUrl}/assignments/launch/${assignment.id}`);
    } else {
      // Generate a secure token for private access
      setIsGeneratingLink(true);
      setTimeout(() => {
        const randomToken = Math.random().toString(36).substring(2, 15) + 
                           Math.random().toString(36).substring(2, 15);
        setShareLink(`${baseUrl}/assignments/launch/${assignment.id}?token=${randomToken}`);
        setIsGeneratingLink(false);
      }, 800);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareLink).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const handleTogglePublic = async () => {
    const newPublicStatus = !isPublic;
    setIsPublic(newPublicStatus);
    
    try {
      // Update assignment in the store/API
      await updateAssignment(assignment.id, { published: newPublicStatus });
      // Regenerate the appropriate link
      generateShareLink(newPublicStatus);
    } catch (error) {
      console.error('Failed to update assignment visibility:', error);
      // Revert UI state on error
      setIsPublic(!newPublicStatus);
    }
  };

  const handleGenerateNewLink = () => {
    generateShareLink(isPublic);
  };

  // Get LTI launch URL based on your Ruby application's routes
  const ltiLaunchUrl = `/api/lti/launch/${assignment.id}`;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="fixed inset-0 z-50 overflow-y-auto" onClose={onClose}>
        <div className="min-h-screen px-4 text-center">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black opacity-30" />
          </Transition.Child>

          <span className="inline-block h-screen align-middle" aria-hidden="true">&#8203;</span>
          
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <div className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
              <Dialog.Title as="div" className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-gray-900">
                  Share Assignment
                </h3>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-500"
                  onClick={onClose}
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </Dialog.Title>

              <div className="mt-4">
                <div className="bg-gray-50 p-3 rounded-md mb-6 border border-gray-200">
                  <h4 className="text-sm font-medium text-gray-700 mb-1">Assignment Details</h4>
                  <p className="text-gray-900 font-medium">{assignment.name}</p>
                  <p className="text-sm text-gray-500 truncate mt-1">
                    ID: {assignment.id}
                  </p>
                </div>

                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                      {isPublic ? (
                        <LockOpenIcon className="h-5 w-5 text-green-500 mr-2" />
                      ) : (
                        <LockClosedIcon className="h-5 w-5 text-gray-500 mr-2" />
                      )}
                      <span className="text-sm font-medium text-gray-700">Public Access</span>
                    </div>
                    <Switch
                      checked={isPublic}
                      onChange={handleTogglePublic}
                      className={`${
                        isPublic ? 'bg-violet-600' : 'bg-gray-200'
                      } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
                    >
                      <span
                        className={`${
                          isPublic ? 'translate-x-6' : 'translate-x-1'
                        } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                      />
                    </Switch>
                  </div>
                  
                  <p className="text-sm text-gray-500 mb-4">
                    {isPublic 
                      ? 'Anyone with the link can access this assignment.' 
                      : 'Only specific users with this secure link can access this assignment.'}
                  </p>
                  
                  {!isPublic && (
                    <button
                      type="button"
                      onClick={handleGenerateNewLink}
                      disabled={isGeneratingLink}
                      className="w-full inline-flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 disabled:opacity-50 disabled:cursor-wait"
                    >
                      {isGeneratingLink ? (
                        <>
                          <ArrowPathIcon className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-500" />
                          Generating secure link...
                        </>
                      ) : (
                        <>
                          <LinkIcon className="h-4 w-4 mr-2" />
                          Generate New Secure Link
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="mt-4">
                  <label htmlFor="share-link" className="block text-sm font-medium text-gray-700 mb-2">
                    Shareable Link
                  </label>
                  <div className="flex">
                    <input
                      type="text"
                      id="share-link"
                      value={shareLink}
                      readOnly
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-violet-500 focus:border-violet-500 bg-gray-50"
                    />
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="inline-flex items-center px-3 py-2 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      {isCopied ? (
                        <span className="text-green-600">Copied!</span>
                      ) : (
                        <DocumentDuplicateIcon className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    This link can be shared with learners to access the assignment.
                  </p>
                </div>
                
                {/* Additional Features */}
                <div className="mt-6 space-y-4">
                  <button
                    onClick={() => setShowQrCode(!showQrCode)}
                    className="flex items-center text-sm text-violet-600 hover:text-violet-800"
                  >
                    <QrCodeIcon className="h-4 w-4 mr-1" />
                    {showQrCode ? 'Hide QR Code' : 'Show QR Code'}
                  </button>
                  
                  {showQrCode && (
                    <div className="flex justify-center p-4 bg-white border border-gray-200 rounded-md">
                      <QRCode value={shareLink} size={150} />
                    </div>
                  )}
                  
                  <button
                    onClick={() => setShowLtiCode(!showLtiCode)}
                    className="flex items-center text-sm text-violet-600 hover:text-violet-800"
                  >
                    <DocumentDuplicateIcon className="h-4 w-4 mr-1" />
                    {showLtiCode ? 'Hide LTI Launch Code' : 'Show LTI Launch Code'}
                  </button>
                  
                  {showLtiCode && (
                    <div className="p-3 bg-gray-50 rounded-md border border-gray-200 font-mono text-xs overflow-x-auto">
                      <pre className="whitespace-pre-wrap">
{`<!-- LTI Launch Form for Assignment ${assignment.id} -->
<form id="lti-launch-form" action="${ltiLaunchUrl}" method="post" encType="application/x-www-form-urlencoded">
  <input type="hidden" name="resource_link_id" value="${assignment.id}" />
  <input type="hidden" name="roles" value="Learner" />
  <!-- Other LTI parameters will be generated automatically -->
  <input type="submit" value="Launch Assignment" />
</form>`}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}