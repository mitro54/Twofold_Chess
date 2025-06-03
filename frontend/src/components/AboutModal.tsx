import React from 'react';
import { FaGithub, FaChess, FaCode, FaRobot } from 'react-icons/fa';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-gray-900/95 rounded-lg border border-indigo-500/30 p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            About Twofold Chess
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="space-y-6 text-gray-300">
          <section>
            <h3 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
              <FaChess className="text-indigo-400" />
              What is Twofold Chess?
            </h3>
            <p className="leading-relaxed">
              Twofold Chess is an innovative chess variant that introduces a second board to the traditional game. 
              This unique twist adds a new layer of strategy and complexity to the classic game of chess.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
              <FaCode className="text-purple-400" />
              Technical Features
            </h3>
            <ul className="list-disc pl-6 space-y-2 text-left">
              <li>Real-time multiplayer gameplay with WebSocket technology and Socket.IO</li>
              <li>Dual-board game mechanics with synchronized piece captures</li>
              <li>Advanced game state management and move validation</li>
              <li>Comprehensive game history tracking and analysis tools</li>
              <li>Dataset generation for machine learning research</li>
              <li>Responsive design optimized for all devices</li>
              <li>Modern UI with smooth animations and transitions</li>
              <li>Secure authentication and session management</li>
              <li>Real-time chat system for player communication</li>
              <li>Automatic game state recovery after disconnections</li>
            </ul>
          </section>

          <section>
            <h3 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
              <FaRobot className="text-pink-400" />
              AI & Machine Learning
            </h3>
            <p className="leading-relaxed">
              The project includes features for collecting game data that can be used to train AI models. 
              Players can download their game history in a structured format suitable for machine learning research.
              In the future, plan is to implement an AI opponent mode where players can challenge models trained on 
              the collected game data, creating a unique opportunity to play against strategies learned from the community.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
              <FaGithub className="text-gray-400" />
              Open Source
            </h3>
            <p className="leading-relaxed">
              Twofold Chess is an open-source project. The codebase is available on GitHub for anyone interested 
              in contributing or learning from the implementation<a href="https://github.com/mitro54/Twofold_Chess" className="text-indigo-400 hover:text-indigo-300"> here</a>.
              Dont know how to code but want to help? Play a game and report bugs!
            </p>
          </section>

          <div className="pt-4 border-t border-gray-700">
            <p className="text-sm text-gray-400">
              Built with Next.js, TypeScript, Tailwind CSS, Flask, Socket.IO, and MongoDB
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutModal; 