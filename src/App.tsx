/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Heart, 
  Send, 
  Moon, 
  Utensils, 
  Baby, 
  Sparkles, 
  MessageCircle,
  Clock,
  User,
  AlertCircle,
  LogOut,
  ChevronLeft,
  Plus
} from 'lucide-react';
import { getCounselingResponse, ChatMessage } from './services/geminiService';
import { auth, db } from './lib/firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  doc,
  updateDoc,
  getDocs,
  limit
} from 'firebase/firestore';

const COLORS = {
  primary: '#5A5A40', // Olive Green
  secondary: '#A39E82', // Muted Beige
  accent: '#C5CEB6', // Soft Leaf
  background: '#FDFCF7', // Off-White
  text: '#333322',
  muted: '#8B8B7A',
  border: '#E6E2D3'
};

const QUICK_TIPS = [
  { icon: <Moon size={18} />, label: "수면 교육", prompt: "아기가 밤에 계속 깨서 울어요. 수면 교육은 어떻게 시작하면 좋을까요?" },
  { icon: <Utensils size={18} />, label: "이유식 가이드", prompt: "우리 아기가 곧 6개월이 되는데, 첫 이유식은 무엇으로 시작하면 좋을까요?" },
  { icon: <Baby size={18} />, label: "울음소리 해독", prompt: "아기가 왜 울고 있는지 모르겠어요. 상황별 울음소리 구분법을 알려주세요." },
  { icon: <Heart size={18} />, label: "심리 상담", prompt: "요즘 육아 때문에 너무 지치고 우울해요. 스스로를 돌보는 방법을 알려주세요." },
];

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthChecking(false);
    });
    return () => unsubscribe();
  }, []);

  // Fetch sessions
  useEffect(() => {
    if (!user) {
      setSessions([]);
      return;
    }

    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setSessions(sessData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'sessions');
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch messages for current session
  useEffect(() => {
    if (!currentSessionId || !user) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'sessions', currentSessionId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ 
        role: d.data().role, 
        text: d.data().text 
      })) as ChatMessage[];
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `sessions/${currentSessionId}/messages`);
    });

    return () => unsubscribe();
  }, [currentSessionId, user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentSessionId(null);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const startNewSession = async (initialText?: string) => {
    if (!user) return null;
    
    try {
      const sessionRef = await addDoc(collection(db, 'sessions'), {
        userId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        title: initialText ? initialText.slice(0, 50) : '새로운 상담'
      });
      setCurrentSessionId(sessionRef.id);
      return sessionRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'sessions');
      return null;
    }
  };

  const handleSend = async (text: string = inputValue) => {
    if (!text.trim() || isLoading || !user) return;

    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = await startNewSession(text);
      if (!sessionId) return;
    }

    setIsLoading(true);
    setInputValue('');

    try {
      // 1. Save user message to Firestore
      await addDoc(collection(db, 'sessions', sessionId, 'messages'), {
        role: 'user',
        text,
        createdAt: serverTimestamp()
      });

      // 2. Get AI Response
      // Note: messages state might not be updated yet due to snapshot lag, 
      // but getCounselingResponse takes history. We can pass the current messages + new one.
      const history = [...messages, { role: 'user', text } as ChatMessage];
      const responseText = await getCounselingResponse(history, text);

      // 3. Save AI message to Firestore
      await addDoc(collection(db, 'sessions', sessionId, 'messages'), {
        role: 'model',
        text: responseText,
        createdAt: serverTimestamp()
      });

      // 4. Update session timestamp
      await updateDoc(doc(db, 'sessions', sessionId), {
        updatedAt: serverTimestamp()
      });

    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FDFCF7]">
        <div className="flex gap-2">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
              className="w-3 h-3 bg-[#A39E82] rounded-full"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#FDFCF7] flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md space-y-10"
        >
          <div className="text-6xl font-serif italic text-[#5A5A40]">Begin.</div>
          <div className="space-y-4">
            <h1 className="text-4xl font-serif text-[#333322]">맘파파 AI 상담소</h1>
            <p className="text-[#6B6B5E] leading-relaxed">
              당신은 이미 훌륭한 부모입니다.<br/>
              혼자 고민하지 마세요. 저희가 곁에 있겠습니다.
            </p>
          </div>
          <button 
            onClick={handleLogin}
            className="w-full py-5 bg-[#5A5A40] text-white rounded-full font-bold uppercase tracking-[0.2em] text-xs shadow-xl shadow-[#5A5A40]/10 hover:bg-[#333322] transition-all flex items-center justify-center gap-3"
          >
            Google 계정으로 시작하기
          </button>
          <p className="text-[10px] text-[#A39E82] uppercase tracking-widest font-bold">
            안전한 로그인을 위해 Google 인증을 사용합니다
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: COLORS.background, color: COLORS.text }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#FDFCF7]/90 backdrop-blur-md border-b border-[#E6E2D3] px-8 md:px-12 py-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setCurrentSessionId(null)}
            className="text-2xl font-serif italic tracking-tight font-bold text-[#5A5A40] hover:opacity-70 transition-opacity"
          >
            Begin.
          </button>
          <div className="hidden md:flex items-center gap-2 border-l border-[#E6E2D3] pl-4">
            <h1 className="text-xs uppercase tracking-[0.2em] font-bold text-[#A39E82]">
              {user.displayName?.split(' ')[0] || 'Parent'}'s Assistant
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleLogout}
            className="p-2 hover:bg-[#F7F4EB] rounded-full transition-colors text-[#8B8B7A]"
            title="로그아웃"
          >
            <LogOut size={18} />
          </button>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 bg-[#F7F4EB] border border-[#E6E2D3] rounded-full transition-colors"
          >
            <Clock className="text-[#5A5A40]" size={18} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full p-6 md:p-12 overflow-hidden">
        {/* Messages Container */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-8 pb-32 pr-4 custom-scrollbar"
        >
          {messages.length === 0 && !currentSessionId ? (
            <div className="flex flex-col md:flex-row items-center gap-12 h-full py-12 animate-in fade-in duration-1000">
              <div className="flex-1 space-y-8 text-center md:text-left">
                <div className="space-y-4">
                  <h4 className="text-[#A39E82] uppercase tracking-[0.3em] text-[10px] font-bold">당신의 첫 번째 육아 파트너</h4>
                  <h1 className="text-5xl md:text-7xl font-serif leading-[1.1] text-[#333322]">
                    서툰 엄마 아빠의<br/>
                    <span className="italic font-light">따뜻한 등불</span>이<br/>
                    되어드릴게요.
                  </h1>
                </div>
                <p className="text-base text-[#6B6B5E] max-w-md leading-relaxed mx-auto md:mx-0">
                  잠 못 드는 밤, 정답 없는 육아 고민들. 전문 AI 상담사가 명쾌한 해답과 따뜻한 위로를 전합니다.
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4 pt-4 justify-center md:justify-start">
                  <button 
                    onClick={() => startNewSession()}
                    className="px-8 py-4 bg-[#5A5A40] text-white rounded-full text-[10px] uppercase font-bold tracking-widest hover:bg-[#333322] transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus size={14} /> 상담 시작하기
                  </button>
                </div>
              </div>
              
              <div className="w-full md:w-5/12 bg-[#F7F4EB] p-8 rounded-[40px] border border-[#E6E2D3] space-y-6">
                <h3 className="text-xs font-bold text-[#A39E82] uppercase tracking-[0.2em]">빠른 도움닫기</h3>
                <div className="grid gap-3">
                  {QUICK_TIPS.map((tip, idx) => (
                    <motion.button
                      key={idx}
                      whileHover={{ x: 5, backgroundColor: 'white' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSend(tip.prompt)}
                      className="flex items-center gap-4 bg-white/50 p-4 rounded-2xl border border-[#E6E2D3] transition-all text-left group"
                    >
                      <div className="p-2 bg-[#FDFCF7] rounded-xl text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
                        {tip.icon}
                      </div>
                      <span className="font-semibold text-xs uppercase tracking-widest text-[#333322]">{tip.label}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex gap-5 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center border ${
                      msg.role === 'user' 
                        ? 'bg-[#5A5A40] border-[#5A5A40] text-white shadow-lg' 
                        : 'bg-white border-[#E6E2D3] text-[#A39E82]'
                    }`}>
                      {msg.role === 'user' ? <User size={20} /> : <div className="text-xl font-serif italic">B.</div>}
                    </div>
                    <div className={`p-6 rounded-[32px] ${
                      msg.role === 'user' 
                        ? 'bg-[#5A5A40] text-white rounded-tr-none' 
                        : 'bg-white text-[#333322] rounded-tl-none border border-[#E6E2D3] shadow-sm leading-relaxed whitespace-pre-wrap'
                    }`}>
                      {msg.role === 'model' && (
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A39E82] mb-3 pb-2 border-b border-[#F7F4EB]">
                          AI Counselor Response
                        </div>
                      )}
                      <p className={msg.role === 'model' ? 'font-sans text-sm' : 'font-medium'}>{msg.text}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start pl-17"
                >
                  <div className="flex gap-2 items-center">
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.3 }}
                          className="w-1.5 h-1.5 bg-[#A39E82] rounded-full"
                        />
                      ))}
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-widest text-[#A39E82] italic">Typing...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* Input Bar */}
        <div className="fixed bottom-0 left-0 right-0 p-6 md:pb-12 pointer-events-none">
          <div className="max-w-4xl mx-auto w-full pointer-events-auto">
            <div className="bg-white border border-[#E6E2D3] rounded-full p-2 shadow-2xl shadow-[#5A5A40]/5 flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="무엇이든 물어보세요..."
                className="flex-1 bg-transparent px-6 py-4 text-[#333322] placeholder:text-[#A39E82] focus:outline-none text-sm font-medium"
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleSend()}
                disabled={!inputValue.trim() || isLoading}
                className={`flex items-center gap-2 px-8 py-4 rounded-full transition-all text-[10px] uppercase font-bold tracking-[0.2em] ${
                  !inputValue.trim() || isLoading 
                    ? 'bg-[#F7F4EB] text-[#A39E82]' 
                    : 'bg-[#5A5A40] text-white'
                }`}
              >
                <span>전송</span>
                <Send size={14} />
              </motion.button>
            </div>
            
            {/* Disclaimer */}
            <div className="mt-4 flex items-center justify-center gap-2 opacity-40 px-4">
              <p className="text-[9px] uppercase tracking-widest text-center font-bold text-[#5A5A40]">
                Est. 2024 Seoul • Begin Counseling Center
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Styled Sidebar (Mobile Drawer style) */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-[#333322]/10 backdrop-blur-sm z-50" 
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-80 bg-[#FDFCF7] z-50 border-l border-[#E6E2D3] p-10 flex flex-col gap-10"
            >
              <div className="flex justify-between items-center">
                <div className="text-xl font-serif italic text-[#5A5A40]">Sessions.</div>
                <button onClick={() => setIsSidebarOpen(false)} className="text-[#A39E82] hover:text-[#5A5A40] uppercase text-[10px] font-bold tracking-widest">닫기</button>
              </div>
              
              <div className="space-y-8 flex-1 overflow-y-auto custom-scrollbar pr-2">
                <div className="space-y-4">
                  <h4 className="text-[10px] font-bold text-[#A39E82] uppercase tracking-[0.2em]">과거 상담 내역</h4>
                  <div className="grid gap-3">
                    {sessions.length === 0 ? (
                      <p className="text-xs text-[#8B8B7A] italic">아직 상담 내역이 없습니다.</p>
                    ) : (
                      sessions.map((sess) => (
                        <button 
                          key={sess.id} 
                          onClick={() => { setCurrentSessionId(sess.id); setIsSidebarOpen(false); }}
                          className={`text-xs font-bold text-[#333322] uppercase tracking-widest flex items-center justify-between p-4 bg-white border rounded-2xl transition-all text-left ${currentSessionId === sess.id ? 'border-[#5A5A40] ring-1 ring-[#5A5A40]' : 'border-[#E6E2D3] hover:border-[#5A5A40]'}`}
                        >
                          <span className="truncate flex-1">{sess.title || '상담 세션'}</span>
                          <div className={`w-1.5 h-1.5 rounded-full ml-2 ${currentSessionId === sess.id ? 'bg-[#5A5A40]' : 'bg-[#E6E2D3]'}`} />
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => { startNewSession(); setIsSidebarOpen(false); }}
                  className="w-full py-4 bg-[#F7F4EB] border border-[#E6E2D3] rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-white flex items-center justify-center gap-2"
                >
                  <Plus size={14} /> 새 상담 시작
                </button>
              </div>
              
              <div className="mt-auto pt-8 border-t border-[#E6E2D3]">
                <div className="flex items-center justify-between opacity-50">
                   <div className="text-[10px] font-bold uppercase tracking-widest">{user.email}</div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E6E2D3;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #A39E82;
        }
      `}} />
    </div>
  );
}
