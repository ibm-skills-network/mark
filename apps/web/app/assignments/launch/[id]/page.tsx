// app/assignments/launch/[id]/page.tsx
"use client";

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowRightIcon,
  CheckBadgeIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  DocumentTextIcon,
  ClockIcon,
  UserIcon,
  QuestionMarkCircleIcon
} from '@heroicons/react/24/outline';

interface Assignment {
  id: number;
  name: string;
  introduction?: string;
  timeEstimateMinutes?: number;
  published: boolean;
}

export default function AssignmentLaunchPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const assignmentId = parseInt(params.id);
  
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [email, setEmail] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  
  useEffect(() => {
    // Fetch assignment details
    const fetchAssignment = async () => {
      try {
        // In a real app, this would be an API call
        // For now, we'll simulate it with mock data
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Mock assignment data
        const mockAssignments = [
          { id: 1, name: 'Introduction to Data Structures', introduction: 'Learn the basics of data structures and algorithms', timeEstimateMinutes: 30, published: true },
          { id: 2, name: 'Python Programming Fundamentals', introduction: 'A comprehensive introduction to Python programming language', timeEstimateMinutes: 45, published: true },
          { id: 3, name: 'Machine Learning Basics', introduction: 'Introduction to fundamental concepts in machine learning', timeEstimateMinutes: 60, published: false },
          { id: 4, name: 'Web Development with React', introduction: 'Learn modern web development using React', timeEstimateMinutes: 90, published: true },
          { id: 5, name: 'Database Design Principles', introduction: 'Understanding database design and normalization', timeEstimateMinutes: 40, published: false },
        ];
        
        const foundAssignment = mockAssignments.find(a => a.id === assignmentId);
        
        if (!foundAssignment) {
          setError('Assignment not found');
        } else if (!foundAssignment.published && !token) {
          setError('This assignment requires a secure token to access');
        } else {
          setAssignment(foundAssignment);
        }
      } catch (err) {
        setError('Failed to load assignment details');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchAssignment();
  }, [assignmentId, token]);
  
  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLaunching(true);
    
    try {
      // Construct the form data
      const formData = new FormData();
      formData.append('user_id', email || 'anonymous_user');
      formData.append('lis_person_name_full', userName || 'Anonymous User');
      formData.append('lis_person_contact_email_primary', email || '');
      formData.append('roles', 'Learner');
      
      if (token) {
        formData.append('token', token);
      }
      
      // Submit to launch endpoint
      const response = await fetch(`/api/lti/launch/${assignmentId}`, {
        method: 'POST',
        body: formData,
      });
      
      if (response.ok) {
        // LTI launch succeeded, response should contain auto-submitting form
        const html = await response.text();
        
        // Create a temporary div to hold the HTML
        const div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div);
        
        // Let the auto-submit script run
        // The script in the response will handle the redirect
      } else {
        // Handle error
        const errorData = await response.json();
        setError(errorData.error || 'Failed to launch assignment');
        setIsLaunching(false);
      }
    } catch (err) {
      setError('An error occurred while launching the assignment');
      setIsLaunching(false);
      console.error(err);
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="w-16 h-16 border-t-4 border-b-4 border-violet-600 rounded-full animate-spin"></div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md">
          <div className="flex justify-center mb-6">
            <div className="bg-red-100 p-3 rounded-full">
              <ExclamationTriangleIcon className="h-10 w-10 text-red-600" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-center text-gray-900 mb-4">Access Error</h1>
          <p className="text-gray-600 text-center mb-6">{error}</p>
          <div className="flex justify-center">
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
            >
              Return to Homepage
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  if (!assignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md">
          <div className="flex justify-center mb-6">
            <div className="bg-gray-100 p-3 rounded-full">
              <QuestionMarkCircleIcon className="h-10 w-10 text-gray-600" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-center text-gray-900 mb-4">Assignment Not Found</h1>
          <p className="text-gray-600 text-center mb-6">The assignment you're looking for could not be found.</p>
          <div className="flex justify-center">
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500"
            >
              Return to Homepage
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-white shadow overflow-hidden sm:rounded-lg"
        >
          <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  {assignment.name}
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">
                  {assignment.published ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      <CheckBadgeIcon className="h-4 w-4 mr-1" />
                      Public Assignment
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-800">
                      <LockClosedIcon className="h-4 w-4 mr-1" />
                      Secure Assignment
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
          
          <div className="px-4 py-5 sm:px-6">
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-500 mb-1">Overview</h4>
              <p className="text-base text-gray-900">
                {assignment.introduction || 'No introduction provided.'}
              </p>
            </div>
            
            <div className="border-t border-gray-200 pt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-center">
                <ClockIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-sm text-gray-500">
                  Estimated time: {assignment.timeEstimateMinutes || 'Not specified'} {assignment.timeEstimateMinutes ? 'minutes' : ''}
                </span>
              </div>
              <div className="flex items-center">
                <DocumentTextIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-sm text-gray-500">
                  Assignment ID: {assignment.id}
                </span>
              </div>
            </div>
          </div>
          
          <div className="px-4 py-5 bg-gray-50 sm:px-6">
            <form onSubmit={handleLaunch}>
              <div className="space-y-4 mb-6">
                <h4 className="text-sm font-medium text-gray-700">Your Information (Optional)</h4>
                <div>
                  <label htmlFor="userName" className="block text-sm font-medium text-gray-700 mb-1">
                    Your Name
                  </label>
                  <input
                    type="text"
                    id="userName"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="shadow-sm focus:ring-violet-500 focus:border-violet-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="shadow-sm focus:ring-violet-500 focus:border-violet-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    placeholder="john@example.com"
                  />
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-500">
                  <UserIcon className="inline-block h-4 w-4 mr-1" />
                  <span>You'll be accessing as a learner</span>
                </div>
                <button
                  type="submit"
                  disabled={isLaunching}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLaunching ? (
                    <>
                      <div className="animate-spin h-4 w-4 mr-2 border-t-2 border-b-2 border-white rounded-full"></div>
                      Launching...
                    </>
                  ) : (
                    <>
                      Launch Assignment
                      <ArrowRightIcon className="ml-2 h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </motion.div>
        
        <p className="mt-4 text-center text-xs text-gray-500">
          This assignment is powered by the Mark Assignment System
        </p>
      </div>
    </div>
  );
}