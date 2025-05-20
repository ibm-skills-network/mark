"use client";
import { useState } from 'react';
import {
  MagnifyingGlassIcon,
  ArrowsUpDownIcon,
  GlobeAltIcon,
  LockClosedIcon,
  ShareIcon,
  LinkIcon,
  PencilIcon,
  DocumentDuplicateIcon,
  QuestionMarkCircleIcon
} from '@heroicons/react/24/outline';
import { Assignment } from '@/config/types';
import AssignmentShareLink from './AssignmentShareLink';
import { 
  useGetAssignmentsQuery, 
  useUpdateAssignmentMutation 
} from '@/lib/admin';
import LoadingSpinner from "../Loading";
import animationData from "@/animations/LoadSN.json";
import { toast } from 'sonner';

export default function AssignmentSharing() {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'status'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterStatus, setFilterStatus] = useState<'all' | 'public' | 'private'>('all');
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  
  // RTK Query hooks
  const { 
    data: assignments = [], 
    isLoading, 
    error 
  } = useGetAssignmentsQuery();
  
  const [updateAssignment, { isLoading: isUpdating }] = useUpdateAssignmentMutation();
  
  // Filter and sort assignments
  const filteredAssignments = assignments
    .filter(assignment => {
      // Apply search filter
      if (searchTerm && !assignment.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      
      // Apply status filter
      if (filterStatus === 'public' && !assignment.published) {
        return false;
      }
      if (filterStatus === 'private' && assignment.published) {
        return false;
      }
      
      return true;
    })
    .sort((a, b) => {
      // Apply sorting
      if (sortBy === 'name') {
        return sortDirection === 'asc' 
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      
      if (sortBy === 'date') {
        const dateA = new Date(a.updatedAt).getTime();
        const dateB = new Date(b.updatedAt).getTime();
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      }
      
      if (sortBy === 'status') {
        return sortDirection === 'asc' 
          ? (a.published ? 1 : 0) - (b.published ? 1 : 0)
          : (b.published ? 1 : 0) - (a.published ? 1 : 0);
      }
      
      return 0;
    });
  
  const handleSort = (key: 'name' | 'date' | 'status') => {
    if (sortBy === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDirection('asc');
    }
  };
  
  const handleUpdateAssignment = async (id: number, data: Partial<Assignment>) => {
    try {
      await updateAssignment({ id, data }).unwrap();
      toast.success('Assignment updated successfully!');
    } catch (error) {
      console.error('Failed to update assignment:', error);
      toast.error('Failed to update assignment.');
    }
  };
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
  };
  
  // Show error state
  if (error) {
    return (
      <div className="p-6 bg-red-50 text-red-600 rounded-md">
        Error loading assignments: {error.toString()}
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-3 py-2 w-full border border-gray-300 rounded-md focus:ring-violet-500 focus:border-violet-500"
                placeholder="Search assignments..."
                disabled={isLoading}
              />
            </div>
            
            <button
              onClick={() => {
                setFilterStatus(
                  filterStatus === 'all' 
                    ? 'public' 
                    : filterStatus === 'public'
                      ? 'private'
                      : 'all'
                );
              }}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50"
              disabled={isLoading}
            >
              {filterStatus === 'public' ? (
                <GlobeAltIcon className="h-5 w-5 mr-2 text-green-600" />
              ) : filterStatus === 'private' ? (
                <LockClosedIcon className="h-5 w-5 mr-2 text-gray-500" />
              ) : (
                <ShareIcon className="h-5 w-5 mr-2 text-gray-500" />
              )}
              <span>
                {filterStatus === 'all' 
                  ? 'All Assignments' 
                  : filterStatus === 'public' 
                    ? 'Public Only' 
                    : 'Private Only'}
              </span>
            </button>
            
            <button
              onClick={() => handleSort(sortBy === 'name' ? 'date' : sortBy === 'date' ? 'status' : 'name')}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50"
              disabled={isLoading}
            >
              <ArrowsUpDownIcon className="h-5 w-5 mr-2" />
              <span>
                Sort by {sortBy === 'name' ? 'Name' : sortBy === 'date' ? 'Date' : 'Status'}
                {' '}
                {sortDirection === 'asc' ? '↑' : '↓'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Assignments List */}
        <div className="lg:col-span-1 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-sm font-medium text-gray-700">Assignments</h2>
          </div>
          
          {isLoading ? (
            <div className="p-4 flex justify-center">
              <LoadingSpinner animationData={animationData} />
            </div>
          ) : filteredAssignments.length > 0 ? (
            <ul className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
              {filteredAssignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className={`px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                    selectedAssignment?.id === assignment.id ? 'bg-violet-50' : ''
                  }`}
                  onClick={() => setSelectedAssignment(assignment)}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{assignment.name}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Updated: {formatDate(String(assignment.updatedAt))}
                      </p>
                    </div>
                    <div className="ml-2 flex-shrink-0">
                      {assignment.published ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          Public
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                          Private
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center">
              <QuestionMarkCircleIcon className="h-10 w-10 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">
                {searchTerm || filterStatus !== 'all'
                  ? "No assignments match your search or filter criteria."
                  : "No assignments available."}
              </p>
              <button
                className="mt-3 text-sm text-violet-600 hover:text-violet-800"
                onClick={() => {
                  setSearchTerm('');
                  setFilterStatus('all');
                }}
              >
                Reset Filters
              </button>
            </div>
          )}
        </div>
        
        {/* Sharing Details */}
        <div className="lg:col-span-3">
          {selectedAssignment ? (
            <AssignmentShareLink
              assignment={selectedAssignment}
              onUpdateAssignment={handleUpdateAssignment}
            />
          ) : (
            <div className="bg-white p-12 rounded-lg shadow-sm border border-gray-100 text-center">
              <LinkIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select an Assignment</h3>
              <p className="text-gray-500 max-w-md mx-auto">
                Choose an assignment from the list to see sharing options and generate shareable links.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Tips */}
      <div className="bg-violet-50 p-5 rounded-lg border border-violet-200">
        <h3 className="text-violet-800 font-medium mb-3 flex items-center">
          <DocumentDuplicateIcon className="h-5 w-5 mr-2" />
          Assignment Sharing Tips
        </h3>
        <ul className="space-y-2 text-sm text-violet-700">
          <li className="flex items-start">
            <span className="text-violet-500 mr-2">•</span>
            <span>
              <strong>Public assignments</strong> can be accessed by anyone with the link. Use for open courses or public assessments.
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-violet-500 mr-2">•</span>
            <span>
              <strong>Private assignments</strong> require a secure token to access. Each link is unique and can be regenerated.
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-violet-500 mr-2">•</span>
            <span>
              You can embed the launch form HTML in your LMS or website to create a seamless integration.
            </span>
          </li>
          <li className="flex items-start">
            <span className="text-violet-500 mr-2">•</span>
            <span>
              Use QR codes to allow students to easily access assignments from mobile devices or printed materials.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}