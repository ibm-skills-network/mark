// AuthorIntroduction.tsx
"use client"
import React, { useState } from 'react';
import MarkdownEditor from '../../../components/MarkDownEditor';

const AuthorIntroduction = () => {
  const [introduction, setIntroduction] = useState("");
  const [instruction, setInstruction] = useState("");
  const [isGraded, setIsGraded] = useState(true); 

  const handleIntroductionChange = (newValue) => {
    setIntroduction(newValue);
  };

  const handleInstructionChange = (newValue) => {
    setInstruction(newValue);
  };

  const handleUngraded = () => {
    setIsGraded(false); // Set isActive to true when the component is focused
  };

  const handleGraded = () => {
    setIsGraded(true); // Set isActive to false when the component loses focus
  };

  return (
    <div>
      <div
      className={`flex flex-col mt-8 pl-2 rounded-md p-4 bg-white`}
      style={{minWidth: '67.5625rem', minHeight: '20.5rem', maxHeight: '50.5rem' }}
      >


          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor" class="w-6 h-6" style={{ transform: 'translate(45px, 120px) scale(2.3)' }}>
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>


          <div style={{ 
            width: 223.17,
            color: '#000000',
            fontSize: 19.17,
            transform: 'translate(105px, 75px)', // Adjust the vertical value as needed
            textAlign: 'left'
          }}>Introduction</div>
      
        <div className="text-gray-500" style={{ 
            fontSize: 16.17,
            transform: 'translate(105px, 75px)', // Adjust the vertical value as needed
          }}>Write a short summary of the learning goals of this assignment and what learners will be required to do</div>


        <div className="w-[1082px] h-[104px] bg-gray-50 rounded-tl-[11px] rounded-tr-[11px] border border-gray-300" />
        <div>
          <MarkdownEditor
            style={{ height: '150px' }}
            value={introduction}
            onChange={handleIntroductionChange}
          />
        </div>
      </div>



      <div
      className={`flex flex-col mt-8 pl-2 rounded-md p-4 bg-white`}
      style={{minWidth: '67.5625rem', minHeight: '20.5rem', maxHeight: '50.5rem' }}
      >




          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor" class="w-6 h-6" style={{ transform: 'translate(45px, 120px) scale(2.3)' }}>
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25M9 16.5v.75m3-3v3M15 12v5.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>



          <div style={{ 
            width: 223.17,
            color: '#000000',
            fontSize: 19.17,
            transform: 'translate(105px, 75px)', // Adjust the vertical value as needed
            textAlign: 'left'
          }}>Instruction</div>
      
      <div className="text-gray-500" style={{ 
            fontSize: 16.17,
            transform: 'translate(105px, 75px)', // Adjust the vertical value as needed
          }}>Write a short summary of the learning goals of this assignment and what learners will be required to do</div>


        <div className="w-[1082px] h-[104px] bg-gray-50 rounded-tl-[11px] rounded-tr-[11px] border border-gray-300" />
        <div>
          <MarkdownEditor
            style={{ height: '150px' }}
            value={instruction}
            onChange={handleInstructionChange}
          />
        </div>
      </div>



















    </div>
  );
};

export default AuthorIntroduction;
