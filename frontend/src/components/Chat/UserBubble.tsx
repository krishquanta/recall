import React from 'react';
import { Message } from '../../types';
import { User } from 'lucide-react';

interface UserBubbleProps {
  message: Message;
}

export const UserBubble: React.FC<UserBubbleProps> = ({ message }) => {
  return (
    <div className="flex justify-end items-start gap-2.5 my-3">
      <div className="flex flex-col items-end max-w-[80%]">
        <div className="bg-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed shadow-sm break-words whitespace-pre-wrap">
          {message.content}
        </div>
        <span className="text-[10px] text-slate-400 mt-1 px-1">
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-200">
        <User className="w-4 h-4" />
      </div>
    </div>
  );
};
