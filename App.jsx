import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, Brain, Target, Activity, Calendar, Clock, 
  ChevronRight, ArrowLeft, Play, CheckCircle, XCircle, 
  AlertCircle, Loader2, Plus, FileText, BarChart3, RefreshCw,
  GraduationCap, Key, ListOrdered, Lightbulb, CheckSquare, RotateCcw, Database
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, doc, setDoc, 
  addDoc, serverTimestamp, deleteDoc 
} from 'firebase/firestore';

// ==========================================
// 1. DYNAMIC ENVIRONMENT SETUP (Canvas vs Local Chrome)
// ==========================================
const isCanvas = typeof __app_id !== 'undefined';
let app, auth, db, appId, firebaseSetupError = null;

try {
  const firebaseConfig = isCanvas 
    ? JSON.parse(__firebase_config) 
    : {
        apiKey: "AIzaSyCeT2LzTKRRCUvkznPIgcPeJhioNPmiEAU",
        authDomain: "study-flow-ai-3375b.firebaseapp.com",
        projectId: "study-flow-ai-3375b",
        storageBucket: "study-flow-ai-3375b.firebasestorage.app",
        messagingSenderId: "504642756421",
        appId: "1:504642756421:web:bfa511832e3e4a4dfe682c"
      };

  appId = isCanvas ? __app_id : 'studyflow-netlify';

  if (!firebaseConfig || !firebaseConfig.apiKey) {
    throw new Error("Missing Firebase credentials in .env");
  }

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  console.error("Firebase Init Error:", error);
  firebaseSetupError = error.message;
}

// ==========================================
// 2. SECURE AI API SERVICE
// ==========================================
const callGemini = async (prompt, systemInstruction, schema) => {
  const maxRetries = 5;
  const baseDelay = 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Sab jagah Netlify Function use karo - NO hardcoded API key!
      const response = await fetch('/.netlify/functions/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, systemInstruction, schema })
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      return data.data;

    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise(res => setTimeout(res, baseDelay * Math.pow(2, attempt)));
    }
  }
};

// --- AI Schemas (Unchanged) ---
const analyzeSyllabusSchema = {
  type: "OBJECT",
  properties: {
    topics: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          difficulty: { type: "STRING" },
          priority: { type: "STRING" },
          priorityReason: { type: "STRING" },
          learnTime: { type: "INTEGER" },
          practiceTime: { type: "INTEGER" },
          revisionTime: { type: "INTEGER" }
        }
      }
    }
  }
};

const teachTopicSchema = {
  type: "OBJECT",
  properties: {
    simpleExplanation: { type: "STRING" },
    academicExplanation: { type: "STRING" },
    keyTerms: { 
      type: "ARRAY", 
      items: { type: "OBJECT", properties: { term: { type: "STRING" }, definition: { type: "STRING" } } }
    },
    processSteps: { type: "ARRAY", items: { type: "STRING" } },
    analogy: { type: "STRING" },
    keyTakeaways: { type: "ARRAY", items: { type: "STRING" } },
    quickCheck: { type: "STRING" }
  }
};

const generateQuizSchema = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
          correctAnswer: { type: "STRING" },
          explanation: { type: "STRING" }
        }
      }
    }
  }
};


// ==========================================
// 3. MAIN APPLICATION COMPONENT
// ==========================================
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [subjects, setSubjects] = useState([]);
  const [topics, setTopics] = useState([]);
  const [quizAttempts, setQuizAttempts] = useState([]);
  
  const [currentView, setCurrentView] = useState('dashboard'); 
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [sessionMode, setSessionMode] = useState('learn'); 
  
  const [error, setError] = useState(null);
  const [loadingMsg, setLoadingMsg] = useState(null);

  // Fallback UI if running locally without Firebase setup
  if (firebaseSetupError) {
    return <SetupNeededScreen error={firebaseSetupError} />;
  }

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          // Normal browser environment uses anonymous auth
          await signInAnonymously(auth);
        }
      } catch (err) {
        setError(`Auth Error: Make sure Anonymous Authentication is enabled in Firebase. (${err.message})`);
        setAuthLoading(false);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const subjectsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'subjects');
    const topicsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'topics');
    const attemptsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'quizAttempts');

    const unsubSubjects = onSnapshot(subjectsRef, (snap) => {
      setSubjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error(err));

    const unsubTopics = onSnapshot(topicsRef, (snap) => {
      setTopics(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error(err));

    const unsubAttempts = onSnapshot(attemptsRef, (snap) => {
      setQuizAttempts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error(err));

    return () => { unsubSubjects(); unsubTopics(); unsubAttempts(); };
  }, [user]);

  const navigate = (view, data = {}) => {
    setError(null);
    if (data.subject) setSelectedSubject(data.subject);
    if (data.topic) setSelectedTopic(data.topic);
    if (data.mode) setSessionMode(data.mode);
    setCurrentView(view);
  };

  const stats = useMemo(() => {
    const completedTopics = topics.filter(t => t.status === 'completed').length;
    const progress = topics.length > 0 ? Math.round((completedTopics / topics.length) * 100) : 0;
    
    const weakTopics = topics.filter(t => t.lastScore !== undefined && t.lastScore < 70);
    const strongTopics = topics.filter(t => t.lastScore !== undefined && t.lastScore >= 70);
    const avgScore = quizAttempts.length > 0 
      ? Math.round(quizAttempts.reduce((acc, curr) => acc + curr.percent, 0) / quizAttempts.length) 
      : 0;
    
    let todaysTasks = [];
    
    subjects.forEach(sub => {
      let timeAvailable = sub.dailyMinutes || 60;
      let usedTime = 0;
      const subTopics = topics.filter(t => t.subjectId === sub.id);
      
      const subWeak = subTopics.filter(t => t.lastScore !== undefined && t.lastScore < 70)
        .sort((a, b) => a.lastScore - b.lastScore);
      
      for (const t of subWeak) {
        if (usedTime + (t.revisionTime || 15) <= timeAvailable) {
          todaysTasks.push({ ...t, taskType: 'Revision', activeTime: t.revisionTime || 15 });
          usedTime += (t.revisionTime || 15);
        }
      }

      const subPending = subTopics.filter(t => t.status !== 'completed')
        .sort((a, b) => {
          const pMap = { High: 3, Medium: 2, Low: 1 };
          return (pMap[b.priority] || 0) - (pMap[a.priority] || 0);
        });

      for (const t of subPending) {
        const requiredTime = (t.learnTime || 25) + (t.practiceTime || 10);
        if (usedTime + requiredTime <= timeAvailable) {
          todaysTasks.push({ ...t, taskType: 'Learn', activeTime: requiredTime });
          usedTime += requiredTime;
        }
      }
    });

    return { completedTopics, totalTopics: topics.length, progress, weakTopics, strongTopics, avgScore, todaysTasks };
  }, [topics, quizAttempts, subjects]);


  if (authLoading) return <LoadingScreen msg="Initializing StudyFlow Securely..." />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-white border-r border-slate-200 flex-shrink-0">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-indigo-600 flex items-center gap-2">
            <Brain className="w-7 h-7" /> StudyFlow AI
          </h1>
        </div>
        <nav className="flex px-4 md:px-0 md:flex-col gap-2 overflow-x-auto md:p-4 pb-4 md:pb-0">
          <NavBtn active={currentView === 'dashboard'} onClick={() => navigate('dashboard')} icon={<Activity />} label="Dashboard" />
          <NavBtn active={['subjectDetail', 'study', 'quiz'].includes(currentView) && subjects.length > 0} onClick={() => navigate('dashboard')} icon={<BookOpen />} label="My Subjects" />
          <NavBtn active={currentView === 'progress'} onClick={() => navigate('progress')} icon={<BarChart3 />} label="Progress Analytics" />
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2"><AlertCircle className="w-5 h-5"/> {error}</div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700"><XCircle className="w-5 h-5"/></button>
          </div>
        )}

        {loadingMsg && (
          <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center max-w-sm w-full mx-4">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
              <p className="text-slate-700 font-medium text-center">{loadingMsg}</p>
            </div>
          </div>
        )}

        {currentView === 'dashboard' && <DashboardView stats={stats} subjects={subjects} navigate={navigate} />}
        {currentView === 'addSubject' && <AddSubjectView user={user} navigate={navigate} setLoadingMsg={setLoadingMsg} setError={setError} />}
        {currentView === 'subjectDetail' && selectedSubject && <SubjectDetailView subject={selectedSubject} topics={topics.filter(t => t.subjectId === selectedSubject.id)} navigate={navigate} />}
        {currentView === 'study' && selectedTopic && <StudySessionView topic={selectedTopic} subject={subjects.find(s => s.id === selectedTopic.subjectId)} mode={sessionMode} navigate={navigate} setLoadingMsg={setLoadingMsg} setError={setError} />}
        {currentView === 'quiz' && selectedTopic && <QuizView user={user} topic={selectedTopic} subject={subjects.find(s => s.id === selectedTopic.subjectId)} topics={topics} navigate={navigate} setLoadingMsg={setLoadingMsg} setError={setError} />}
        {currentView === 'progress' && <ProgressView stats={stats} navigate={navigate} subjects={subjects} />}
      </main>
    </div>
  );
}

// ==========================================
// VIEWS & COMPONENTS
// ==========================================

function NavBtn({ active, onClick, icon, label }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all whitespace-nowrap ${
        active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {React.cloneElement(icon, { className: 'w-5 h-5' })}
      <span>{label}</span>
    </button>
  );
}

function LoadingScreen({ msg }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-indigo-600">
        <Loader2 className="w-12 h-12 animate-spin" />
        <p className="font-medium text-lg text-slate-700">{msg}</p>
      </div>
    </div>
  );
}

function SetupNeededScreen({ error }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-3xl max-w-lg w-full border border-slate-200 shadow-xl text-center">
        <Database className="w-16 h-16 text-rose-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Local Setup Required</h2>
        <p className="text-slate-600 mb-6">
          To run StudyFlow AI in a normal browser, you need to provide your Firebase and Gemini credentials.
        </p>
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm mb-6 text-left font-mono break-all">
          Error: {error}
        </div>
        <div className="text-left bg-slate-50 p-6 rounded-xl border border-slate-200 text-sm">
          <p className="font-bold text-slate-800 mb-2">Next Steps:</p>
          <ol className="list-decimal pl-5 space-y-2 text-slate-600">
            <li>Create a `.env` file in your frontend root.</li>
            <li>Add `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, etc.</li>
            <li>Ensure Firestore and <b>Anonymous Authentication</b> are enabled in Firebase.</li>
            <li>Start the backend server on port 3001 with your Gemini Key.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// --- ALL OTHER VIEWS ARE UNCHANGED AND PRESERVED EXACTLY AS BEFORE ---

function DashboardView({ stats, subjects, navigate }) {
  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">Welcome back!</h2>
          <p className="text-slate-500 mt-1">Here is your optimized study plan for today.</p>
        </div>
        <button onClick={() => navigate('addSubject')} className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl hover:bg-indigo-700 transition shadow-sm font-medium">
          <Plus className="w-5 h-5" /> Add New Subject
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard icon={<Target />} label="Overall Mastery" value={`${stats.progress}%`} sub={`of ${stats.totalTopics} topics`} color="blue" />
        <MetricCard icon={<Clock />} label="Topics Completed" value={stats.completedTopics} sub="Keep it up!" color="emerald" />
        <MetricCard icon={<AlertCircle />} label="Need Revision" value={stats.weakTopics.length} sub="Score < 70%" color="rose" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Play className="w-5 h-5 text-indigo-600" /> Today's Action Plan
          </h3>
          <p className="text-sm text-slate-500 -mt-2">Intelligently filtered to fit your available daily time.</p>
          
          {stats.todaysTasks.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center">
              <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
              <h4 className="text-lg font-medium text-slate-700">All caught up for today!</h4>
              <p className="text-slate-500 mt-1">Add a new subject or browse your subjects to study ahead.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stats.todaysTasks.map(task => {
                const subject = subjects.find(s => s.id === task.subjectId);
                const isRevision = task.taskType === 'Revision';
                
                return (
                  <div key={task.id} className={`bg-white p-5 rounded-2xl border ${isRevision ? 'border-rose-200 shadow-sm' : 'border-slate-200 shadow-sm'} flex flex-col md:flex-row md:items-center justify-between gap-4 transition hover:shadow-md`}>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-bold px-2 py-1 bg-slate-100 text-slate-600 rounded-md">{subject?.name || 'Subject'}</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded-md ${isRevision ? 'bg-rose-100 text-rose-700' : 'bg-indigo-100 text-indigo-700'}`}>{task.taskType}</span>
                        {!isRevision && task.priorityReason && (
                          <span className="text-xs text-amber-600 font-medium flex items-center gap-1"><Lightbulb className="w-3 h-3"/> {task.priorityReason}</span>
                        )}
                      </div>
                      <h4 className="font-semibold text-slate-900 text-lg">{task.name}</h4>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-sm text-slate-500 flex items-center gap-1"><Clock className="w-4 h-4"/> ~{task.activeTime} mins</span>
                        {isRevision && <span className="text-sm text-rose-600 font-medium">Previous Score: {task.lastScore}%</span>}
                      </div>
                    </div>
                    <button 
                      onClick={() => navigate('study', { topic: task, subject, mode: isRevision ? 'revise' : 'learn' })}
                      className={`px-6 py-2.5 rounded-xl font-medium transition shrink-0 ${isRevision ? 'bg-rose-100 text-rose-700 hover:bg-rose-200' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                    >
                      {isRevision ? 'Revise Now' : 'Start Session'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-600" /> My Subjects
          </h3>
          <div className="space-y-3">
            {subjects.length === 0 ? (
              <p className="text-slate-500 bg-white p-4 rounded-xl border border-slate-200 text-center text-sm">No subjects added yet.</p>
            ) : (
              subjects.map(sub => (
                <div key={sub.id} onClick={() => navigate('subjectDetail', { subject: sub })} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-400 hover:shadow-md transition group">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold text-slate-900 group-hover:text-indigo-600 transition">{sub.name}</h4>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition" />
                  </div>
                  <div className="flex flex-col gap-1 text-xs text-slate-500">
                    <span>Target: {sub.dailyMinutes} mins/day</span>
                    {sub.examDate && <span>Exam: {sub.examDate}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, color }) {
  const colorMap = { blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', rose: 'bg-rose-50 text-rose-600' };
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-500 font-medium text-sm">{label}</p>
          <h3 className="text-3xl font-bold text-slate-900 mt-2">{value}</h3>
          <p className="text-xs text-slate-400 mt-1">{sub}</p>
        </div>
        <div className={`p-3 rounded-xl ${colorMap[color]}`}>
          {React.cloneElement(icon, { className: 'w-6 h-6' })}
        </div>
      </div>
    </div>
  );
}

function AddSubjectView({ user, navigate, setLoadingMsg, setError }) {
  const [formData, setFormData] = useState({ name: '', examDate: '', syllabus: '', dailyMinutes: 60 });
  const handleAnalyze = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.syllabus) { setError("Please provide a subject name and syllabus."); return; }
    
    const textToAnalyze = formData.syllabus.substring(0, 40000); 
    setLoadingMsg("AI is analyzing syllabus & structuring bite-sized sessions...");
    setError(null);

    try {
      const prompt = `Analyze this syllabus for "${formData.name}". Extract topics. Break down large chapters into smaller, logical sub-topics. Set realistic learnTime (15-35 mins), practiceTime (5-15 mins), and revisionTime (10-15 mins) for EACH. Provide a brief reason for priority. Syllabus: ${textToAnalyze}`;
      const systemInstruction = "You are an expert curriculum designer. Output structured JSON. Break down large subjects into realistic 20-40 minute study sessions. Be scientifically logical in the progression.";
      
      const analysis = await callGemini(prompt, systemInstruction, analyzeSyllabusSchema);
      
      const subjectRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'subjects'), {
        name: formData.name, examDate: formData.examDate, dailyMinutes: parseInt(formData.dailyMinutes) || 60, createdAt: serverTimestamp()
      });

      for (const topic of analysis.topics) {
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'topics'), {
          subjectId: subjectRef.id, name: topic.name, difficulty: topic.difficulty || 'Medium', priority: topic.priority || 'Medium',
          priorityReason: topic.priorityReason || '', learnTime: topic.learnTime || 25, practiceTime: topic.practiceTime || 10,
          revisionTime: topic.revisionTime || 10, status: 'pending', createdAt: serverTimestamp()
        });
      }
      setLoadingMsg(null); navigate('dashboard');
    } catch (err) {
      console.error(err); setLoadingMsg(null); setError(err.message || "Failed to process syllabus.");
    }
  };

  return (
    <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={() => navigate('dashboard')} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6 transition">
        <ArrowLeft className="w-4 h-4"/> Back to Dashboard
      </button>
      <div className="bg-white rounded-3xl p-6 md:p-10 border border-slate-200 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Create New Subject</h2>
        <p className="text-slate-500 mb-8">Paste your syllabus. AI will break it down into realistic daily study sessions.</p>
        <form onSubmit={handleAnalyze} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Subject Name</label>
              <input type="text" required placeholder="e.g., Biology: Reproduction" className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none transition" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Available Time (Mins/Day)</label>
              <input type="number" min="10" max="300" required className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none transition" value={formData.dailyMinutes} onChange={e => setFormData({...formData, dailyMinutes: e.target.value})} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Paste Syllabus or Notes (Text)</label>
            <textarea required rows={8} placeholder="Paste your chapter names, topics, or learning objectives here..." className="w-full p-4 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none transition resize-y font-mono text-sm" value={formData.syllabus} onChange={e => setFormData({...formData, syllabus: e.target.value})} />
          </div>
          <button type="submit" className="w-full bg-indigo-600 text-white font-semibold text-lg py-4 rounded-xl hover:bg-indigo-700 transition flex items-center justify-center gap-2 shadow-md hover:shadow-lg">
            <Brain className="w-5 h-5" /> Generate Smart Study Plan
          </button>
        </form>
      </div>
    </div>
  );
}

function SubjectDetailView({ subject, topics, navigate }) {
  const completed = topics.filter(t => t.status === 'completed').length;
  const progress = topics.length > 0 ? Math.round((completed / topics.length) * 100) : 0;
  return (
    <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={() => navigate('dashboard')} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6 transition"><ArrowLeft className="w-4 h-4"/> Dashboard</button>
      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-4">{subject.name}</h1>
        <div className="mb-2 flex justify-between text-sm font-medium text-slate-600"><span>Course Progress</span><span>{progress}%</span></div>
        <div className="w-full bg-slate-100 rounded-full h-3 mb-6"><div className="bg-indigo-600 h-3 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }}></div></div>
        <div className="flex gap-4 text-sm text-slate-500">
          <span className="flex items-center gap-1"><Clock className="w-4 h-4"/> Target: {subject.dailyMinutes}m / day</span>
          <span className="flex items-center gap-1"><FileText className="w-4 h-4"/> {topics.length} Sub-topics</span>
        </div>
      </div>
      <h3 className="text-xl font-bold text-slate-900 mb-4">Complete Topic Breakdown</h3>
      <div className="space-y-3">
        {topics.map((topic, index) => (
          <div key={topic.id} className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className={`mt-1 shrink-0 w-6 h-6 rounded-full flex items-center justify-center border-2 ${topic.status === 'completed' ? 'border-emerald-500 bg-emerald-50 text-emerald-500' : 'border-slate-300'}`}>
                {topic.status === 'completed' && <CheckCircle className="w-4 h-4" />}
              </div>
              <div>
                <h4 className={`text-lg font-semibold ${topic.status === 'completed' ? 'text-slate-600' : 'text-slate-900'}`}>{index + 1}. {topic.name}</h4>
                <div className="flex flex-wrap gap-3 mt-2 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1"><BookOpen className="w-3 h-3"/> {topic.learnTime}m learn</span>
                  <span className="flex items-center gap-1"><Target className="w-3 h-3"/> {topic.practiceTime}m quiz</span>
                  <span className="flex items-center gap-1"><RotateCcw className="w-3 h-3"/> {topic.revisionTime}m revise</span>
                </div>
                {topic.lastScore !== undefined && (
                  <div className="mt-2"><span className={`text-xs px-2 py-1 rounded-md font-bold ${topic.lastScore >= 70 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>Previous Score: {topic.lastScore}%</span></div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => navigate('study', { subject, topic, mode: topic.status === 'completed' ? 'revise' : 'learn' })} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition">
                {topic.status === 'completed' ? 'Revise' : 'Learn'}
              </button>
              <button onClick={() => navigate('quiz', { subject, topic })} className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-medium hover:bg-indigo-100 transition">Test</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudySessionView({ subject, topic, mode, navigate, setLoadingMsg, setError }) {
  const [material, setMaterial] = useState(null);
  useEffect(() => {
    let isMounted = true;
    const fetchLesson = async () => {
      setLoadingMsg(`AI Teacher is preparing ${mode === 'revise' ? 'revision' : 'lesson'} on ${topic.name}...`);
      setError(null);
      try {
        const prompt = `Teach "${topic.name}" from "${subject.name}". Provide simple explanation, formal academic explanation, define key terms, list process steps if applicable, give a safe/accurate analogy, and a quick check question.`;
        const systemInstruction = "You are an expert academic tutor. Ensure complete scientific and factual accuracy. Format response to match the JSON schema perfectly.";
        const data = await callGemini(prompt, systemInstruction, teachTopicSchema);
        if (isMounted) { setMaterial(data); setLoadingMsg(null); }
      } catch (err) {
        if (isMounted) { setError("Failed to load lesson. Please try again."); setLoadingMsg(null); }
      }
    };
    fetchLesson(); return () => { isMounted = false; };
  }, [topic.name, subject.name, mode]);

  if (!material) return null;

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={() => navigate('subjectDetail', { subject })} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6 transition"><ArrowLeft className="w-4 h-4"/> Back to {subject.name}</button>
      <div className="bg-white rounded-3xl p-6 md:p-10 border border-slate-200 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className={`inline-flex px-3 py-1 rounded-full text-sm font-bold ${mode === 'revise' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>{mode === 'revise' ? 'Targeted Revision' : 'Learning Session'}</div>
          <span className="text-sm font-medium text-slate-500 flex items-center gap-1"><Clock className="w-4 h-4"/> Est: {mode === 'revise' ? topic.revisionTime : topic.learnTime} mins</span>
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-8">{topic.name}</h2>
        <div className="space-y-8">
          <section>
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-3"><BookOpen className="w-5 h-5 text-indigo-500"/> Simple Explanation</h3>
            <p className="text-slate-700 leading-relaxed bg-slate-50 p-5 rounded-2xl">{material.simpleExplanation}</p>
          </section>
          <section>
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-3"><GraduationCap className="w-5 h-5 text-emerald-600"/> Academic Detail</h3>
            <p className="text-slate-800 leading-relaxed bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">{material.academicExplanation}</p>
          </section>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {material.keyTerms && material.keyTerms.length > 0 && (
              <section>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-3"><Key className="w-5 h-5 text-amber-500"/> Key Terms</h3>
                <div className="bg-amber-50 p-5 rounded-2xl border border-amber-100 space-y-3">
                  {material.keyTerms.map((kt, idx) => (<div key={idx}><span className="font-bold text-amber-900 block">{kt.term}</span><span className="text-sm text-amber-800">{kt.definition}</span></div>))}
                </div>
              </section>
            )}
            {material.processSteps && material.processSteps.length > 0 && (
              <section>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-3"><ListOrdered className="w-5 h-5 text-blue-500"/> Process / Steps</h3>
                <ul className="bg-blue-50 p-5 rounded-2xl border border-blue-100 space-y-2">
                  {material.processSteps.map((step, idx) => (<li key={idx} className="text-sm text-blue-900 flex gap-2"><span className="font-bold">{idx + 1}.</span> {step}</li>))}
                </ul>
              </section>
            )}
          </div>
          <section>
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-3"><Lightbulb className="w-5 h-5 text-purple-500"/> Helpful Analogy</h3>
            <p className="text-purple-900 italic bg-purple-50 p-5 rounded-2xl border border-purple-100">"{material.analogy}"</p>
          </section>
          <section>
            <div className="bg-slate-900 text-white p-6 rounded-2xl flex items-start gap-4 shadow-md">
              <CheckSquare className="w-6 h-6 text-indigo-400 shrink-0 mt-1"/>
              <div>
                <h4 className="font-bold text-lg mb-1">Quick Check</h4><p className="text-slate-300 text-sm">{material.quickCheck}</p>
                <p className="text-xs text-slate-500 mt-3">Think about this before moving to the quiz.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-4 justify-end">
        <button onClick={() => navigate('subjectDetail', { subject })} className="px-6 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition">End Session</button>
        <button onClick={() => navigate('quiz', { subject, topic })} className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow-sm flex items-center justify-center gap-2">Take Topic Quiz <ChevronRight className="w-4 h-4"/></button>
      </div>
    </div>
  );
}

function QuizView({ user, subject, topic, topics, navigate, setLoadingMsg, setError }) {
  const [quiz, setQuiz] = useState(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [resultData, setResultData] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchQuiz = async () => {
      setLoadingMsg(`Generating practice test for ${topic.name}...`); setError(null);
      try {
        const prompt = `Create a 5-question multiple choice quiz testing "${topic.name}" in "${subject.name}".`;
        const systemInstruction = "You are an examiner. Generate challenging but fair multiple-choice questions.";
        const data = await callGemini(prompt, systemInstruction, generateQuizSchema);
        if (isMounted) { setQuiz(data.questions); setLoadingMsg(null); }
      } catch (err) {
        if (isMounted) { setError("Failed to generate quiz."); setLoadingMsg(null); }
      }
    };
    fetchQuiz(); return () => { isMounted = false; };
  }, [topic.name, subject.name]);

  const handleOptionSelect = (qIndex, option) => { if (!submitted) setAnswers({ ...answers, [qIndex]: option }); };
  const handleSubmit = async () => {
    if (Object.keys(answers).length < quiz.length) return setError("Please answer all questions before submitting.");
    setError(null); setLoadingMsg("Grading test...");
    let calculatedScore = 0; const mistakes = [];
    quiz.forEach((q, idx) => {
      if (answers[idx] === q.correctAnswer) calculatedScore++;
      else mistakes.push({ question: q.question, selected: answers[idx], correct: q.correctAnswer, explanation: q.explanation });
    });
    const percentScore = Math.round((calculatedScore / quiz.length) * 100);
    setResultData({ score: percentScore, mistakes }); setSubmitted(true);
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'quizAttempts'), { subjectId: subject.id, topicId: topic.id, score: calculatedScore, total: quiz.length, percent: percentScore, date: serverTimestamp() });
      const topicRef = doc(db, 'artifacts', appId, 'users', user.uid, 'topics', topic.id);
      await setDoc(topicRef, { status: 'completed', lastScore: percentScore }, { merge: true });
    } catch (err) { console.error("Failed to save progress:", err); } finally { setLoadingMsg(null); }
  };

  if (!quiz) return null;
  if (submitted && resultData) {
    const isPass = resultData.score >= 70;
    const subTopics = topics.filter(t => t.subjectId === subject.id);
    const nextTopic = subTopics.find(t => t.status !== 'completed' && t.id !== topic.id);
    return (
      <div className="max-w-3xl mx-auto animate-in zoom-in-95 duration-500 mt-4">
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm text-center mb-8">
          <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 ${isPass ? 'bg-emerald-100 text-emerald-500' : 'bg-rose-100 text-rose-500'}`}><Target className="w-10 h-10" /></div>
          <h2 className="text-4xl font-bold text-slate-900 mb-2">Score: {resultData.score}%</h2>
          <p className="text-slate-600 mb-6 max-w-md mx-auto">{isPass ? "Great job! You have a solid understanding." : "More practice needed. We recommend a focused revision session."}</p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            {!isPass && <button onClick={() => navigate('study', { subject, topic, mode: 'revise' })} className="bg-rose-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-rose-700 transition flex items-center justify-center gap-2"><RotateCcw className="w-5 h-5"/> Start Revision Now</button>}
            {isPass && nextTopic && <button onClick={() => navigate('study', { subject, topic: nextTopic, mode: 'learn' })} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 transition flex items-center justify-center gap-2">Next Topic: {nextTopic.name} <ChevronRight className="w-5 h-5"/></button>}
            <button onClick={() => navigate('subjectDetail', { subject })} className="bg-slate-100 text-slate-700 border border-slate-300 px-6 py-3 rounded-xl font-medium hover:bg-slate-200 transition">Back to Plan</button>
          </div>
        </div>
        {!isPass && resultData.mistakes.length > 0 && (
          <div className="mb-8">
            <h3 className="text-xl font-bold text-rose-800 flex items-center gap-2 mb-4"><AlertCircle className="w-5 h-5" /> Specific Weak Areas to Review</h3>
            <div className="space-y-4">
              {resultData.mistakes.map((m, idx) => (
                <div key={idx} className="bg-rose-50 p-5 rounded-2xl border border-rose-200">
                  <p className="font-semibold text-slate-900 mb-2">Q: {m.question}</p>
                  <p className="text-sm text-rose-700 line-through mb-1">Your answer: {m.selected}</p>
                  <p className="text-sm text-emerald-700 font-bold mb-3">Correct answer: {m.correct}</p>
                  <p className="text-sm text-slate-700 bg-white p-3 rounded-xl border border-rose-100 shadow-sm">{m.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const q = quiz[currentQ];
  return (
    <div className="max-w-2xl mx-auto mt-4 animate-in fade-in duration-300">
      <div className="flex justify-between items-center mb-6">
        <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">Test Mode</span>
        <span className="text-sm font-medium text-slate-500 flex items-center gap-1"><Clock className="w-4 h-4"/> Est: {topic.practiceTime}m</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2 mb-8"><div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: `${((currentQ) / quiz.length) * 100}%` }}></div></div>
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm mb-6">
        <span className="text-sm font-bold text-slate-400 block mb-2">Question {currentQ + 1} of {quiz.length}</span>
        <h3 className="text-xl font-semibold text-slate-900 mb-6">{q.question}</h3>
        <div className="space-y-3">
          {q.options.map((opt, idx) => {
            const isSelected = answers[currentQ] === opt;
            return (
              <button key={idx} onClick={() => handleOptionSelect(currentQ, opt)} className={`w-full text-left p-4 rounded-xl border-2 transition-all ${isSelected ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-medium' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50 text-slate-700'}`}>{opt}</button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between">
        <button disabled={currentQ === 0} onClick={() => setCurrentQ(prev => prev - 1)} className="px-6 py-3 text-slate-600 disabled:opacity-50 font-medium hover:bg-slate-100 rounded-xl transition">Previous</button>
        {currentQ === quiz.length - 1 ? <button onClick={handleSubmit} className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow-sm">Submit Test</button> : <button onClick={() => setCurrentQ(prev => prev + 1)} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition shadow-sm">Next</button>}
      </div>
    </div>
  );
}

function ProgressView({ stats, navigate, subjects }) {
  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div><h2 className="text-3xl font-bold text-slate-900">Performance Analytics</h2></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center"><p className="text-slate-500 text-sm font-medium mb-1">Mastery</p><p className="text-2xl font-bold text-blue-600">{stats.progress}%</p></div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center"><p className="text-slate-500 text-sm font-medium mb-1">Avg Score</p><p className="text-2xl font-bold text-indigo-600">{stats.avgScore}%</p></div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center"><p className="text-slate-500 text-sm font-medium mb-1">Strong Topics</p><p className="text-2xl font-bold text-emerald-600">{stats.strongTopics.length}</p></div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center"><p className="text-slate-500 text-sm font-medium mb-1">Weak Topics</p><p className="text-2xl font-bold text-rose-600">{stats.weakTopics.length}</p></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 shadow-sm">
          <h3 className="text-lg font-bold text-emerald-800 mb-4 flex items-center gap-2"><CheckCircle className="w-5 h-5" /> Strongest Areas (≥70%)</h3>
          {stats.strongTopics.length === 0 ? <p className="text-emerald-700/80 text-sm">Complete some tests to build your strong topics list.</p> : (
            <div className="space-y-3">
              {stats.strongTopics.map(topic => (<div key={topic.id} className="bg-white p-3 rounded-xl flex justify-between items-center shadow-sm border border-emerald-50"><div><h4 className="font-semibold text-slate-900 text-sm">{topic.name}</h4></div><span className="font-bold text-emerald-600">{topic.lastScore}%</span></div>))}
            </div>
          )}
        </div>
        <div className="bg-rose-50 p-6 rounded-2xl border border-rose-100 shadow-sm">
          <h3 className="text-lg font-bold text-rose-800 mb-4 flex items-center gap-2"><Target className="w-5 h-5" /> Needs Revision (&lt;70%)</h3>
          {stats.weakTopics.length === 0 ? <p className="text-rose-600/80 text-sm">You don't have any weak topics right now. Great job!</p> : (
            <div className="space-y-3">
              {stats.weakTopics.map(topic => (<div key={topic.id} className="bg-white p-3 rounded-xl flex justify-between items-center shadow-sm border border-rose-50"><div><h4 className="font-semibold text-slate-900 text-sm">{topic.name}</h4></div><button onClick={() => navigate('study', { subject: subjects.find(s=>s.id===topic.subjectId), topic, mode: 'revise' })} className="text-xs bg-rose-100 text-rose-700 px-3 py-1.5 rounded-lg font-bold hover:bg-rose-200 transition">Revise Now</button></div>))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
