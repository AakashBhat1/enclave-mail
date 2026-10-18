import React from 'react';
import { Folder, ProviderEnclave } from '../types/index';
import { Inbox, Star, Send, FileText, Archive, PenSquare, Folder as FolderIcon, RefreshCw } from 'lucide-react';

interface FolderTreeProps {
  currentProvider: ProviderEnclave | null;
  folders: Folder[];
  activeFolderId: string;
  onSelectFolder: (folderId: string) => void;
  onOpenComposer: () => void;
  onSync: () => void;
  isSyncing: boolean;
}

export const FolderTree: React.FC<FolderTreeProps> = ({
  currentProvider,
  folders,
  activeFolderId,
  onSelectFolder,
  onOpenComposer,
  onSync,
  isSyncing,
}) => {
  const getIcon = (id: string) => {
    switch (id) {
      case 'inbox':
        return <Inbox className="w-4 h-4" />;
      case 'starred':
        return <Star className="w-4 h-4" />;
      case 'sent':
        return <Send className="w-4 h-4" />;
      case 'drafts':
        return <FileText className="w-4 h-4" />;
      case 'archive':
        return <Archive className="w-4 h-4" />;
      default:
        return <FolderIcon className="w-4 h-4" />;
    }
  };

  return (
    <div className="w-64 bg-enclave-900 border-r border-enclave-800/80 flex flex-col h-full select-none">
      {/* Current Enclave Info */}
      <div className="p-4 border-b border-enclave-800/70">
        <div className="flex items-center justify-between">
          <div className="truncate">
            <h2 className="text-sm font-semibold text-white truncate">{currentProvider?.name || 'Workspace'}</h2>
            <p className="text-xs text-gray-400 truncate">{currentProvider?.email || 'No Account Selected'}</p>
          </div>
          <button
            onClick={onSync}
            disabled={isSyncing}
            className={`p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-enclave-800 transition-colors ${
              isSyncing ? 'animate-spin text-blue-400' : ''
            }`}
            title="Sync Enclave Mailbox"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Compose Button */}
        <button
          onClick={onOpenComposer}
          className="mt-4 w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded-xl flex items-center justify-center space-x-2 shadow-lg shadow-blue-600/20 transition-all hover:shadow-blue-500/30"
        >
          <PenSquare className="w-4 h-4" />
          <span className="text-sm">Compose</span>
        </button>
      </div>

      {/* Folders List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="text-[11px] font-semibold text-gray-500 px-3 py-1 uppercase tracking-wider">Folders</div>
        {folders.map((folder) => {
          const isActive = folder.id === activeFolderId;

          return (
            <button
              key={folder.id}
              onClick={() => onSelectFolder(folder.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600/15 text-blue-400 font-semibold border border-blue-500/20'
                  : 'text-gray-300 hover:bg-enclave-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className={isActive ? 'text-blue-400' : 'text-gray-400'}>{getIcon(folder.id)}</span>
                <span>{folder.name}</span>
              </div>

              {folder.unreadCount > 0 && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    isActive ? 'bg-blue-500 text-white' : 'bg-enclave-800 text-gray-300'
                  }`}
                >
                  {folder.unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Enclave Status Bar */}
      <div className="p-3 border-t border-enclave-800/70 text-xs text-gray-500 flex items-center justify-between">
        <span className="flex items-center space-x-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
          <span>Isolated DB</span>
        </span>
        <span className="font-mono text-[11px]">SQLite WAL</span>
      </div>
    </div>
  );
};
