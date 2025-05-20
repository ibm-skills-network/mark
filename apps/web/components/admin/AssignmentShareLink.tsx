// components/admin/AssignmentShareLink.tsx
"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  ClipboardDocumentIcon,
  LinkIcon,
  CheckIcon,
  GlobeAltIcon,
  LockClosedIcon,
  UserGroupIcon,
  ArrowPathIcon,
  QrCodeIcon
} from '@heroicons/react/24/outline';
import { Switch } from '@headlessui/react';
import { Assignment } from '@/config/types';
import QRCode from 'qrcode.react';

interface AssignmentShareLinkProps {
  assignment: Assignment;
  onUpdateAssignment: (id: number, data: Partial<Assignment>) => Promise<void>;
}

export default function AssignmentShareLink({ assignment, onUpdateAssignment }: AssignmentShareLinkProps) {
  const [isPublic, setIsPublic] = useState(assignment.published || false);
  const [shareUrl, setShareUrl] = useState('');
  const [showQrCode, setShowQrCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [authToken, setAuthToken] = useState('');
  
  useEffect(() => {
    // Generate the base URL for sharing
    const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/assignments/launch/` : '';
    
    // If the assignment is public, use a simple URL
    if (isPublic) {
      setShareUrl(`${baseUrl}${assignment.id}`);
    } else if (authToken) {
      // If private with a token, include the token
      setShareUrl(`${baseUrl}${assignment.id}?token=${authToken}`);
    } else {
      // If private with no token yet, just show the base pattern
      setShareUrl(`${baseUrl}${assignment.id}?token=[secure-token]`);
    }
  }, [assignment.id, isPublic, authToken]);
  
  const generateSecureToken = () => {
    setIsGenerating(true);
    
    // In a real implementation, this would be an API call to generate a secure token
    // For now, we'll simulate it with a random string
    setTimeout(() => {
      const randomToken = Math.random().toString(36).substring(2, 15) + 
                         Math.random().toString(36).substring(2, 15);
      setAuthToken(randomToken);
      setIsGenerating(false);
    }, 800);
  };
  
  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const handleTogglePublic = async () => {
    try {
      // Toggle the state immediately for better UX
      setIsPublic(!isPublic);
      
      // Update the assignment in the backend
      await onUpdateAssignment(assignment.id, { published: !isPublic });
      
      // If making it private, clear any existing token
      if (isPublic) {
        setAuthToken('');
      }
    } catch (error) {
      // If the update fails, revert the UI state
      setIsPublic(isPublic);
      console.error('Failed to update assignment visibility:', error);
    }
  };
  
  // This would be the actual LTI launch URL in a real implementation
  const ltiLaunchUrl = `/api/lti/launch/${assignment.id}`;
  
  return (
    <div className="space-y-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden"
      >
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
          <div className="flex items-center">
            <LinkIcon className="h-5 w-5 text-gray-500 mr-2" />
            <h2 className="text-lg font-medium text-gray-900">Assignment Sharing</h2>
          </div>
        </div>
        
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Assignment Details</h3>
            <p className="text-base font-medium text-gray-900">{assignment.name}</p>
            <p className="text-sm text-gray-500 mt-1">ID: {assignment.id}</p>
          </div>
          
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center">
              {isPublic ? (
                <GlobeAltIcon className="h-5 w-5 text-green-600 mr-2" />
              ) : (
                <LockClosedIcon className="h-5 w-5 text-gray-500 mr-2" />
              )}
              <div>
                <span className="text-sm font-medium text-gray-900">
                  {isPublic ? 'Public Access' : 'Private Access'}
                </span>
                <p className="text-xs text-gray-500">
                  {isPublic 
                    ? 'Anyone with the link can access this assignment' 
                    : 'Only learners with a secure token can access this assignment'
                  }
                </p>
              </div>
            </div>
            <Switch
              checked={isPublic}
              onChange={handleTogglePublic}
              className={`${
                isPublic ? 'bg-green-500' : 'bg-gray-300'
              } relative inline-flex h-6 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  isPublic ? 'translate-x-7' : 'translate-x-1'
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>
          
          {!isPublic && (
            <div className="mt-2">
              <button
                onClick={generateSecureToken}
                disabled={isGenerating}
                className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
              >
                {isGenerating ? (
                  <>
                    <ArrowPathIcon className="animate-spin h-4 w-4 mr-2" />
                    Generating secure token...
                  </>
                ) : (
                  <>
                    <LinkIcon className="h-4 w-4 mr-2" />
                    {authToken ? 'Regenerate Secure Token' : 'Generate Secure Token'}
                  </>
                )}
              </button>
            </div>
          )}
          
          <div className="mt-4 space-y-2">
            <div>
              <label htmlFor="share-link" className="block text-sm font-medium text-gray-700 mb-1">
                Shareable Link
              </label>
              <div className="flex">
                <input
                  type="text"
                  id="share-link"
                  value={shareUrl}
                  readOnly
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-violet-500 focus:border-violet-500 bg-gray-50"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center px-3 py-2 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {copied ? (
                    <CheckIcon className="h-5 w-5 text-green-600" />
                  ) : (
                    <ClipboardDocumentIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {isPublic 
                  ? 'This link can be shared with anyone to give them access to the assignment.' 
                  : 'This link includes a secure token and should only be shared with intended learners.'
                }
              </p>
            </div>
            
            {/* LTI HTML Form Generator */}
            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  LTI Launch HTML
                </label>
                <button
                  type="button"
                  onClick={() => setShowQrCode(!showQrCode)}
                  className="inline-flex items-center px-2 py-1 text-xs font-medium text-violet-700 bg-violet-100 rounded-md hover:bg-violet-200"
                >
                  <QrCodeIcon className="h-4 w-4 mr-1" />
                  {showQrCode ? 'Hide QR Code' : 'Show QR Code'}
                </button>
              </div>
              
              <div className="flex">
                {showQrCode && (
                  <div className="p-4 bg-white border border-gray-300 rounded-md mr-4">
                    <QRCode value={shareUrl} size={120} />
                  </div>
                )}
                
                <div className={`flex-1 ${showQrCode ? '' : 'w-full'}`}>
                  <div className="p-3 bg-gray-100 rounded-md border border-gray-300 font-mono text-xs overflow-x-auto">
                    <pre className="whitespace-pre-wrap text-gray-800">
{`<!-- LTI Launch Form for Assignment ${assignment.id} -->
<form id="lti-launch-form" method="post" action="${ltiLaunchUrl}" encType="application/x-www-form-urlencoded">
  <!-- LTI Parameters will be automatically generated -->
  <input type="hidden" name="resource_link_id" value="${assignment.id}" />
  <input type="hidden" name="roles" value="Learner" />
  <input type="submit" value="Launch Assignment" class="button" />
</form>`}
                    </pre>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    This HTML can be embedded in your LMS or website to launch the assignment.
                  </p>
                </div>
              </div>
            </div>
            
            {/* Advanced Options */}
            <div className="mt-6 pt-4 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Advanced Options</h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <UserGroupIcon className="h-5 w-5 text-gray-500 mr-2" />
                    <span className="text-sm text-gray-700">Limit number of attempts</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className="w-20 px-2 py-1 border border-gray-300 rounded-md text-sm"
                    defaultValue={assignment.numAttempts || 1}
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <ClipboardDocumentIcon className="h-5 w-5 text-gray-500 mr-2" />
                    <span className="text-sm text-gray-700">Allow reattempts</span>
                  </div>
                  <Switch
                    checked={true}
                    onChange={() => {}}
                    className={`${'bg-violet-600'} relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
                  >
                    <span
                      className={`${'translate-x-6'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                    />
                  </Switch>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <GlobeAltIcon className="h-5 w-5 text-gray-500 mr-2" />
                    <span className="text-sm text-gray-700">Require authentication</span>
                  </div>
                  <Switch
                    checked={!isPublic}
                    onChange={handleTogglePublic}
                    className={`${!isPublic ? 'bg-violet-600' : 'bg-gray-300'} relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2`}
                  >
                    <span
                      className={`${
                        !isPublic ? 'translate-x-6' : 'translate-x-1'
                      } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                    />
                  </Switch>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}