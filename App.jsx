import React, { useState, useEffect, useMemo } from 'react';
import {
  BookOpen, Brain, Target, Activity, Calendar, Clock,
  ChevronRight, ArrowLeft, Play, CheckCircle, XCircle,
  AlertCircle, Loader2, Plus, FileText, BarChart3, RefreshCw,
  GraduationCap, Key, ListOrdered, Lightbulb, CheckSquare, RotateCcw, Database
} from 'lucide-react';

import { initializeApp } from 'firebase/app';

import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged
} from 'firebase/auth';

import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  setDoc,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';


// ==========================================
// 1. FIREBASE SETUP
// ==========================================

const isCanvas = typeof __app_id !== 'undefined';

let app = null;
let auth = null;
let db = null;
let appId = null;
let firebaseSetupError = null;

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
    throw new Error("Missing Firebase configuration.");
  }

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

} catch (error) {
  console.error("Firebase Init Error:", error);
  firebaseSetupError = error?.message || "Firebase initialization failed.";
}


// ==========================================
// 2. SECURE GEMINI API SERVICE
// ==========================================

const callGemini = async (prompt, systemInstruction, schema) => {

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {

    try {

      const response = await fetch(
        '/.netlify/functions/generate-plan',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            prompt,
            systemInstruction,
            schema
          })
        }
      );

      // Read response safely
      const responseText = await response.text();

      let responseData = {};

      try {
        responseData = responseText
          ? JSON.parse(responseText)
          : {};
      } catch {
        responseData = {
          error: responseText
        };
      }

      // IMPORTANT:
      // Show the actual backend/Gemini error instead of only 404/500.
      if (!response.ok) {

        const errorMessage =
          responseData?.details ||
          responseData?.error ||
          `API Error: ${response.status}`;

        throw new Error(
          typeof errorMessage === 'string'
            ? errorMessage
            : JSON.stringify(errorMessage)
        );
      }

      if (!responseData?.success) {

        throw new Error(
          responseData?.error ||
          "Gemini returned an unsuccessful response."
        );
      }

      if (!responseData?.data) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }

      return responseData.data;

    } catch (error) {

      console.error(
        `Gemini attempt ${attempt + 1} failed:`,
        error
      );

      if (attempt === maxRetries - 1) {
        throw error;
      }

      await new Promise(resolve =>
        setTimeout(
          resolve,
          baseDelay * Math.pow(2, attempt)
        )
      );
    }
  }

  throw new Error("Gemini request failed.");
};


// ==========================================
// 3. AI SCHEMAS
// ==========================================

const analyzeSyllabusSchema = {
  type: "OBJECT",

  properties: {

    topics: {

      type: "ARRAY",

      items: {

        type: "OBJECT",

        properties: {

          name: {
            type: "STRING"
          },

          difficulty: {
            type: "STRING"
          },

          priority: {
            type: "STRING"
          },

          priorityReason: {
            type: "STRING"
          },

          learnTime: {
            type: "INTEGER"
          },

          practiceTime: {
            type: "INTEGER"
          },

          revisionTime: {
            type: "INTEGER"
          }

        }
      }
    }
  }
};


const teachTopicSchema = {

  type: "OBJECT",

  properties: {

    simpleExplanation: {
      type: "STRING"
    },

    academicExplanation: {
      type: "STRING"
    },

    keyTerms: {

      type: "ARRAY",

      items: {

        type: "OBJECT",

        properties: {

          term: {
            type: "STRING"
          },

          definition: {
            type: "STRING"
          }

        }
      }
    },

    processSteps: {

      type: "ARRAY",

      items: {
        type: "STRING"
      }
    },

    analogy: {
      type: "STRING"
    },

    keyTakeaways: {

      type: "ARRAY",

      items: {
        type: "STRING"
      }
    },

    quickCheck: {
      type: "STRING"
    }
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

          question: {
            type: "STRING"
          },

          options: {

            type: "ARRAY",

            items: {
              type: "STRING"
            }
          },

          correctAnswer: {
            type: "STRING"
          },

          explanation: {
            type: "STRING"
          }

        }
      }
    }
  }
};


// ==========================================
// 4. MAIN APPLICATION
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


  // ==========================================
  // AUTH
  // ==========================================

  useEffect(() => {

    if (firebaseSetupError || !auth) {
      setAuthLoading(false);
      return;
    }

    let unsubscribe = null;

    const initAuth = async () => {

      try {

        if (
          typeof __initial_auth_token !== 'undefined' &&
          __initial_auth_token
        ) {

          await signInWithCustomToken(
            auth,
            __initial_auth_token
          );

        } else {

          await signInAnonymously(auth);

        }

      } catch (err) {

        console.error("Auth Error:", err);

        setError(
          `Auth Error: ${err?.message || "Authentication failed."}`
        );

        setAuthLoading(false);
      }
    };

    initAuth();

    unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {

        setUser(currentUser);
        setAuthLoading(false);

      }
    );

    return () => {

      if (unsubscribe) {
        unsubscribe();
      }

    };

  }, []);


  // ==========================================
  // FIRESTORE LISTENERS
  // ==========================================

  useEffect(() => {

    if (!user || !db) {
      return;
    }

    const subjectsRef = collection(
      db,
      'artifacts',
      appId,
      'users',
      user.uid,
      'subjects'
    );

    const topicsRef = collection(
      db,
      'artifacts',
      appId,
      'users',
      user.uid,
      'topics'
    );

    const attemptsRef = collection(
      db,
      'artifacts',
      appId,
      'users',
      user.uid,
      'quizAttempts'
    );


    const unsubSubjects = onSnapshot(
      subjectsRef,
      (snap) => {

        setSubjects(
          snap.docs.map(docItem => ({
            id: docItem.id,
            ...docItem.data()
          }))
        );

      },
      (err) => {
        console.error("Subjects error:", err);
      }
    );


    const unsubTopics = onSnapshot(
      topicsRef,
      (snap) => {

        setTopics(
          snap.docs.map(docItem => ({
            id: docItem.id,
            ...docItem.data()
          }))
        );

      },
      (err) => {
        console.error("Topics error:", err);
      }
    );


    const unsubAttempts = onSnapshot(
      attemptsRef,
      (snap) => {

        setQuizAttempts(
          snap.docs.map(docItem => ({
            id: docItem.id,
            ...docItem.data()
          }))
        );

      },
      (err) => {
        console.error("Quiz attempts error:", err);
      }
    );


    return () => {

      unsubSubjects();
      unsubTopics();
      unsubAttempts();

    };

  }, [user]);


  // ==========================================
  // NAVIGATION
  // ==========================================

  const navigate = (view, data = {}) => {

    setError(null);

    if (data.subject) {
      setSelectedSubject(data.subject);
    }

    if (data.topic) {
      setSelectedTopic(data.topic);
    }

    if (data.mode) {
      setSessionMode(data.mode);
    }

    setCurrentView(view);
  };


  // ==========================================
  // STATS
  // ==========================================

  const stats = useMemo(() => {

    const completedTopics =
      topics.filter(
        t => t.status === 'completed'
      ).length;


    const progress =
      topics.length > 0
        ? Math.round(
            (completedTopics / topics.length) * 100
          )
        : 0;


    const weakTopics =
      topics.filter(
        t =>
          t.lastScore !== undefined &&
          t.lastScore < 70
      );


    const strongTopics =
      topics.filter(
        t =>
          t.lastScore !== undefined &&
          t.lastScore >= 70
      );


    const avgScore =
      quizAttempts.length > 0
        ? Math.round(
            quizAttempts.reduce(
              (acc, curr) =>
                acc + (curr.percent || 0),
              0
            ) / quizAttempts.length
          )
        : 0;


    let todaysTasks = [];


    subjects.forEach(subject => {

      const timeAvailable =
        subject.dailyMinutes || 60;

      let usedTime = 0;


      const subTopics =
        topics.filter(
          t => t.subjectId === subject.id
        );


      const subWeak =
        subTopics
          .filter(
            t =>
              t.lastScore !== undefined &&
              t.lastScore < 70
          )
          .sort(
            (a, b) =>
              a.lastScore - b.lastScore
          );


      for (const topic of subWeak) {

        const revisionTime =
          topic.revisionTime || 15;

        if (
          usedTime + revisionTime <=
          timeAvailable
        ) {

          todaysTasks.push({
            ...topic,
            taskType: 'Revision',
            activeTime: revisionTime
          });

          usedTime += revisionTime;
        }
      }


      const subPending =
        subTopics
          .filter(
            t => t.status !== 'completed'
          )
          .sort((a, b) => {

            const pMap = {
              High: 3,
              Medium: 2,
              Low: 1
            };

            return (
              (pMap[b.priority] || 0) -
              (pMap[a.priority] || 0)
            );

          });


      for (const topic of subPending) {

        const requiredTime =
          (topic.learnTime || 25) +
          (topic.practiceTime || 10);


        if (
          usedTime + requiredTime <=
          timeAvailable
        ) {

          todaysTasks.push({
            ...topic,
            taskType: 'Learn',
            activeTime: requiredTime
          });

          usedTime += requiredTime;
        }
      }

    });


    return {
      completedTopics,
      totalTopics: topics.length,
      progress,
      weakTopics,
      strongTopics,
      avgScore,
      todaysTasks
    };

  }, [topics, quizAttempts, subjects]);


  // ==========================================
  // FIREBASE ERROR SCREEN
  // ==========================================

  if (firebaseSetupError) {

    return (
      <SetupNeededScreen
        error={firebaseSetupError}
      />
    );

  }


  // ==========================================
  // LOADING
  // ==========================================

  if (authLoading) {

    return (
      <LoadingScreen
        msg="Initializing StudyFlow Securely..."
      />
    );

  }


  // ==========================================
  // MAIN UI
  // ==========================================

  return (

    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col md:flex-row">

      <aside className="w-full md:w-64 bg-white border-r border-slate-200 flex-shrink-0">

        <div className="p-6">

          <h1 className="text-2xl font-bold text-indigo-600 flex items-center gap-2">

            <Brain className="w-7 h-7" />

            StudyFlow AI

          </h1>

        </div>


        <nav className="flex px-4 md:px-0 md:flex-col gap-2 overflow-x-auto md:p-4 pb-4 md:pb-0">

          <NavBtn
            active={currentView === 'dashboard'}
            onClick={() => navigate('dashboard')}
            icon={<Activity />}
            label="Dashboard"
          />

          <NavBtn
            active={
              ['subjectDetail', 'study', 'quiz'].includes(currentView) &&
              subjects.length > 0
            }
            onClick={() => navigate('dashboard')}
            icon={<BookOpen />}
            label="My Subjects"
          />

          <NavBtn
            active={currentView === 'progress'}
            onClick={() => navigate('progress')}
            icon={<BarChart3 />}
            label="Progress Analytics"
          />

        </nav>

      </aside>


      <main className="flex-1 overflow-y-auto p-4 md:p-8">

        {error && (

          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start justify-between gap-3">

            <div className="flex items-start gap-2 break-words">

              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />

              <span>{error}</span>

            </div>

            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 shrink-0"
            >

              <XCircle className="w-5 h-5" />

            </button>

          </div>

        )}


        {loadingMsg && (

          <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-50 flex items-center justify-center">

            <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center max-w-sm w-full mx-4">

              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />

              <p className="text-slate-700 font-medium text-center">
                {loadingMsg}
              </p>

            </div>

          </div>

        )}


        {currentView === 'dashboard' && (

          <DashboardView
            stats={stats}
            subjects={subjects}
            navigate={navigate}
          />

        )}


        {currentView === 'addSubject' && (

          <AddSubjectView
            user={user}
            navigate={navigate}
            setLoadingMsg={setLoadingMsg}
            setError={setError}
          />

        )}


        {currentView === 'subjectDetail' &&
          selectedSubject && (

            <SubjectDetailView
              subject={selectedSubject}
              topics={topics.filter(
                t =>
                  t.subjectId ===
                  selectedSubject.id
              )}
              navigate={navigate}
            />

          )}


        {currentView === 'study' &&
          selectedTopic && (

            <StudySessionView
              topic={selectedTopic}
              subject={subjects.find(
                s =>
                  s.id ===
                  selectedTopic.subjectId
              )}
              mode={sessionMode}
              navigate={navigate}
              setLoadingMsg={setLoadingMsg}
              setError={setError}
            />

          )}


        {currentView === 'quiz' &&
          selectedTopic && (

            <QuizView
              user={user}
              topic={selectedTopic}
              subject={subjects.find(
                s =>
                  s.id ===
                  selectedTopic.subjectId
              )}
              topics={topics}
              navigate={navigate}
              setLoadingMsg={setLoadingMsg}
              setError={setError}
            />

          )}


        {currentView === 'progress' && (

          <ProgressView
            stats={stats}
            navigate={navigate}
            subjects={subjects}
          />

        )}

      </main>

    </div>

  );

}


// ==========================================
// NAV BUTTON
// ==========================================

function NavBtn({
  active,
  onClick,
  icon,
  label
}) {

  return (

    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all whitespace-nowrap ${
        active
          ? 'bg-indigo-50 text-indigo-700 font-medium'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >

      {React.cloneElement(icon, {
        className: 'w-5 h-5'
      })}

      <span>{label}</span>

    </button>

  );

}


// ==========================================
// LOADING SCREEN
// ==========================================

function LoadingScreen({ msg }) {

  return (

    <div className="min-h-screen bg-slate-50 flex items-center justify-center">

      <div className="flex flex-col items-center gap-4 text-indigo-600">

        <Loader2 className="w-12 h-12 animate-spin" />

        <p className="font-medium text-lg text-slate-700">
          {msg}
        </p>

      </div>

    </div>

  );

}


// ==========================================
// SETUP ERROR
// ==========================================

function SetupNeededScreen({ error }) {

  return (

    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">

      <div className="bg-white p-8 rounded-3xl max-w-lg w-full border border-slate-200 shadow-xl text-center">

        <Database className="w-16 h-16 text-rose-500 mx-auto mb-4" />

        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Firebase Setup Error
        </h2>

        <p className="text-slate-600 mb-6">
          StudyFlow could not initialize Firebase.
        </p>

        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm text-left break-all">
          Error: {error}
        </div>

      </div>

    </div>

  );

}


// ==========================================
// DASHBOARD
// ==========================================

function DashboardView({
  stats,
  subjects,
  navigate
}) {

  return (

    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">

        <div>

          <h2 className="text-3xl font-bold text-slate-900">
            Welcome back!
          </h2>

          <p className="text-slate-500 mt-1">
            Here is your optimized study plan for today.
          </p>

        </div>


        <button
          onClick={() => navigate('addSubject')}
          className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl hover:bg-indigo-700 transition shadow-sm font-medium"
        >

          <Plus className="w-5 h-5" />

          Add New Subject

        </button>

      </header>


      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        <MetricCard
          icon={<Target />}
          label="Overall Mastery"
          value={`${stats.progress}%`}
          sub={`of ${stats.totalTopics} topics`}
          color="blue"
        />

        <MetricCard
          icon={<Clock />}
          label="Topics Completed"
          value={stats.completedTopics}
          sub="Keep it up!"
          color="emerald"
        />

        <MetricCard
          icon={<AlertCircle />}
          label="Need Revision"
          value={stats.weakTopics.length}
          sub="Score < 70%"
          color="rose"
        />

      </div>


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        <div className="lg:col-span-2 space-y-4">

          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">

            <Play className="w-5 h-5 text-indigo-600" />

            Today's Action Plan

          </h3>

          <p className="text-sm text-slate-500 -mt-2">
            Intelligently filtered to fit your available daily time.
          </p>


          {stats.todaysTasks.length === 0 ? (

            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center">

              <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />

              <h4 className="text-lg font-medium text-slate-700">
                All caught up for today!
              </h4>

              <p className="text-slate-500 mt-1">
                Add a new subject or browse your subjects to study ahead.
              </p>

            </div>

          ) : (

            <div className="space-y-3">

              {stats.todaysTasks.map(task => {

                const subject =
                  subjects.find(
                    s =>
                      s.id ===
                      task.subjectId
                  );

                const isRevision =
                  task.taskType ===
                  'Revision';


                return (

                  <div
                    key={task.id}
                    className={`bg-white p-5 rounded-2xl border ${
                      isRevision
                        ? 'border-rose-200 shadow-sm'
                        : 'border-slate-200 shadow-sm'
                    } flex flex-col md:flex-row md:items-center justify-between gap-4`}
                  >

                    <div className="flex-1">

                      <div className="flex flex-wrap items-center gap-2 mb-1">

                        <span className="text-xs font-bold px-2 py-1 bg-slate-100 text-slate-600 rounded-md">
                          {subject?.name || 'Subject'}
                        </span>

                        <span
                          className={`text-xs font-bold px-2 py-1 rounded-md ${
                            isRevision
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-indigo-100 text-indigo-700'
                          }`}
                        >
                          {task.taskType}
                        </span>

                        {!isRevision &&
                          task.priorityReason && (

                            <span className="text-xs text-amber-600 font-medium flex items-center gap-1">

                              <Lightbulb className="w-3 h-3" />

                              {task.priorityReason}

                            </span>

                          )}

                      </div>


                      <h4 className="font-semibold text-slate-900 text-lg">
                        {task.name}
                      </h4>


                      <div className="flex items-center gap-4 mt-1">

                        <span className="text-sm text-slate-500 flex items-center gap-1">

                          <Clock className="w-4 h-4" />

                          ~{task.activeTime} mins

                        </span>

                        {isRevision && (

                          <span className="text-sm text-rose-600 font-medium">
                            Previous Score: {task.lastScore}%
                          </span>

                        )}

                      </div>

                    </div>


                    <button
                      onClick={() =>
                        navigate(
                          'study',
                          {
                            topic: task,
                            subject,
                            mode: isRevision
                              ? 'revise'
                              : 'learn'
                          }
                        )
                      }
                      className={`px-6 py-2.5 rounded-xl font-medium transition shrink-0 ${
                        isRevision
                          ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                          : 'bg-slate-900 text-white hover:bg-slate-800'
                      }`}
                    >

                      {isRevision
                        ? 'Revise Now'
                        : 'Start Session'}

                    </button>

                  </div>

                );

              })}

            </div>

          )}

        </div>


        <div className="space-y-4">

          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">

            <BookOpen className="w-5 h-5 text-indigo-600" />

            My Subjects

          </h3>


          <div className="space-y-3">

            {subjects.length === 0 ? (

              <p className="text-slate-500 bg-white p-4 rounded-xl border border-slate-200 text-center text-sm">
                No subjects added yet.
              </p>

            ) : (

              subjects.map(subject => (

                <div
                  key={subject.id}
                  onClick={() =>
                    navigate(
                      'subjectDetail',
                      { subject }
                    )
                  }
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-400 hover:shadow-md transition group"
                >

                  <div className="flex justify-between items-center mb-2">

                    <h4 className="font-semibold text-slate-900 group-hover:text-indigo-600 transition">
                      {subject.name}
                    </h4>

                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-indigo-600" />

                  </div>

                  <div className="flex flex-col gap-1 text-xs text-slate-500">

                    <span>
                      Target: {subject.dailyMinutes} mins/day
                    </span>

                    {subject.examDate && (

                      <span>
                        Exam: {subject.examDate}
                      </span>

                    )}

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


// ==========================================
// METRIC CARD
// ==========================================

function MetricCard({
  icon,
  label,
  value,
  sub,
  color
}) {

  const colorMap = {

    blue:
      'bg-blue-50 text-blue-600',

    emerald:
      'bg-emerald-50 text-emerald-600',

    rose:
      'bg-rose-50 text-rose-600'

  };


  return (

    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">

      <div className="flex items-start justify-between">

        <div>

          <p className="text-slate-500 font-medium text-sm">
            {label}
          </p>

          <h3 className="text-3xl font-bold text-slate-900 mt-2">
            {value}
          </h3>

          <p className="text-xs text-slate-400 mt-1">
            {sub}
          </p>

        </div>


        <div
          className={`p-3 rounded-xl ${colorMap[color]}`}
        >

          {React.cloneElement(
            icon,
            {
              className:
                'w-6 h-6'
            }
          )}

        </div>

      </div>

    </div>

  );

}


// ==========================================
// ADD SUBJECT
// ==========================================

function AddSubjectView({
  user,
  navigate,
  setLoadingMsg,
  setError
}) {

  const [formData, setFormData] =
    useState({
      name: '',
      examDate: '',
      syllabus: '',
      dailyMinutes: 60
    });


  const handleAnalyze = async (e) => {

    e.preventDefault();


    if (
      !formData.name ||
      !formData.syllabus
    ) {

      setError(
        "Please provide a subject name and syllabus."
      );

      return;
    }


    const textToAnalyze =
      formData.syllabus.substring(
        0,
        40000
      );


    setLoadingMsg(
      "AI is analyzing syllabus & structuring bite-sized sessions..."
    );

    setError(null);


    try {

      const prompt = `
Analyze this syllabus for "${formData.name}".

Extract the topics and break large chapters into smaller logical sub-topics.

For each topic provide:
- name
- difficulty
- priority
- priorityReason
- learnTime between 15 and 35 minutes
- practiceTime between 5 and 15 minutes
- revisionTime between 10 and 15 minutes

Keep the study sessions realistic.

Syllabus:
${textToAnalyze}
`;


      const systemInstruction = `
You are an expert curriculum designer.

Output only valid structured JSON matching the provided schema.

Break large subjects into realistic study sessions.

Do not invent unrelated chapters or topics.
Use only the information present in the supplied syllabus.
`;


      const analysis =
        await callGemini(
          prompt,
          systemInstruction,
          analyzeSyllabusSchema
        );


      if (
        !analysis ||
        !Array.isArray(analysis.topics)
      ) {

        throw new Error(
          "AI returned an invalid study plan."
        );

      }


      const subjectRef =
        await addDoc(
          collection(
            db,
            'artifacts',
            appId,
            'users',
            user.uid,
            'subjects'
          ),
          {
            name: formData.name,
            examDate: formData.examDate,
            dailyMinutes:
              parseInt(
                formData.dailyMinutes
              ) || 60,
            createdAt:
              serverTimestamp()
          }
        );


      for (
        const topic of analysis.topics
      ) {

        await addDoc(
          collection(
            db,
            'artifacts',
            appId,
            'users',
            user.uid,
            'topics'
          ),
          {

            subjectId:
              subjectRef.id,

            name:
              topic.name,

            difficulty:
              topic.difficulty ||
              'Medium',

            priority:
              topic.priority ||
              'Medium',

            priorityReason:
              topic.priorityReason ||
              '',

            learnTime:
              topic.learnTime ||
              25,

            practiceTime:
              topic.practiceTime ||
              10,

            revisionTime:
              topic.revisionTime ||
              10,

            status:
              'pending',

            createdAt:
              serverTimestamp()

          }
        );

      }


      setLoadingMsg(null);

      navigate('dashboard');


    } catch (err) {

      console.error(
        "Syllabus analysis error:",
        err
      );

      setLoadingMsg(null);

      setError(
        err?.message ||
        "Failed to process syllabus."
      );

    }

  };


  return (

    <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">

      <button
        onClick={() =>
          navigate('dashboard')
        }
        className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6"
      >

        <ArrowLeft className="w-4 h-4" />

        Back to Dashboard

      </button>


      <div className="bg-white rounded-3xl p-6 md:p-10 border border-slate-200 shadow-sm">

        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Create New Subject
        </h2>

        <p className="text-slate-500 mb-8">
          Paste your syllabus. AI will break it down into realistic daily study sessions.
        </p>


        <form
          onSubmit={handleAnalyze}
          className="space-y-6"
        >

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            <div>

              <label className="block text-sm font-medium text-slate-700 mb-2">
                Subject Name
              </label>

              <input
                type="text"
                required
                placeholder="e.g., Class 12 Biology"
                className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.name}
                onChange={e =>
                  setFormData({
                    ...formData,
                    name: e.target.value
                  })
                }
              />

            </div>


            <div>

              <label className="block text-sm font-medium text-slate-700 mb-2">
                Available Time (Mins/Day)
              </label>

              <input
                type="number"
                min="10"
                max="300"
                required
                className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.dailyMinutes}
                onChange={e =>
                  setFormData({
                    ...formData,
                    dailyMinutes:
                      e.target.value
                  })
                }
              />

            </div>

          </div>


          <div>

            <label className="block text-sm font-medium text-slate-700 mb-2">
              Paste Syllabus or Notes (Text)
            </label>

            <textarea
              required
              rows={8}
              placeholder="Paste your chapter names, topics, or learning objectives here..."
              className="w-full p-4 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none resize-y font-mono text-sm"
              value={formData.syllabus}
              onChange={e =>
                setFormData({
                  ...formData,
                  syllabus:
                    e.target.value
                })
              }
            />

          </div>


          <button
            type="submit"
            className="w-full bg-indigo-600 text-white font-semibold text-lg py-4 rounded-xl hover:bg-indigo-700 transition flex items-center justify-center gap-2 shadow-md"
          >

            <Brain className="w-5 h-5" />

            Generate Smart Study Plan

          </button>

        </form>

      </div>

    </div>

  );

}


// ==========================================
// SUBJECT DETAIL
// ==========================================

function SubjectDetailView({
  subject,
  topics,
  navigate
}) {

  const completed =
    topics.filter(
      t =>
        t.status ===
        'completed'
    ).length;


  const progress =
    topics.length > 0
      ? Math.round(
          (completed /
            topics.length) *
          100
        )
      : 0;


  return (

    <div className="max-w-4xl mx-auto">

      <button
        onClick={() =>
          navigate(
            'dashboard'
          )
        }
        className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6"
      >

        <ArrowLeft className="w-4 h-4" />

        Dashboard

      </button>


      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm mb-8">

        <h1 className="text-3xl font-bold text-slate-900 mb-4">
          {subject.name}
        </h1>


        <div className="mb-2 flex justify-between text-sm font-medium text-slate-600">

          <span>
            Course Progress
          </span>

          <span>
            {progress}%
          </span>

        </div>


        <div className="w-full bg-slate-100 rounded-full h-3 mb-6">

          <div
            className="bg-indigo-600 h-3 rounded-full transition-all"
            style={{
              width:
                `${progress}%`
            }}
          />

        </div>


        <div className="flex gap-4 text-sm text-slate-500">

          <span className="flex items-center gap-1">

            <Clock className="w-4 h-4" />

            Target:
            {' '}
            {subject.dailyMinutes}m/day

          </span>


          <span className="flex items-center gap-1">

            <FileText className="w-4 h-4" />

            {topics.length}
            {' '}
            Sub-topics

          </span>

        </div>

      </div>


      <h3 className="text-xl font-bold text-slate-900 mb-4">
        Complete Topic Breakdown
      </h3>


      <div className="space-y-3">

        {topics.map(
          (topic, index) => (

            <div
              key={topic.id}
              className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >

              <div className="flex items-start gap-4">

                <div
                  className={`mt-1 shrink-0 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                    topic.status ===
                    'completed'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-500'
                      : 'border-slate-300'
                  }`}
                >

                  {topic.status ===
                    'completed' && (

                    <CheckCircle className="w-4 h-4" />

                  )}

                </div>


                <div>

                  <h4
                    className={`text-lg font-semibold ${
                      topic.status ===
                      'completed'
                        ? 'text-slate-600'
                        : 'text-slate-900'
                    }`}
                  >

                    {index + 1}.
                    {' '}
                    {topic.name}

                  </h4>


                  <div className="flex flex-wrap gap-3 mt-2 text-xs font-medium text-slate-500">

                    <span>
                      📖 {topic.learnTime}m learn
                    </span>

                    <span>
                      🎯 {topic.practiceTime}m quiz
                    </span>

                    <span>
                      🔄 {topic.revisionTime}m revise
                    </span>

                  </div>


                  {topic.lastScore !== undefined && (

                    <div className="mt-2">

                      <span
                        className={`text-xs px-2 py-1 rounded-md font-bold ${
                          topic.lastScore >= 70
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >

                        Previous Score:
                        {' '}
                        {topic.lastScore}%

                      </span>

                    </div>

                  )}

                </div>

              </div>


              <div className="flex gap-2">

                <button
                  onClick={() =>
                    navigate(
                      'study',
                      {
                        subject,
                        topic,
                        mode:
                          topic.status ===
                          'completed'
                            ? 'revise'
                            : 'learn'
                      }
                    )
                  }
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium"
                >

                  {topic.status ===
                  'completed'
                    ? 'Revise'
                    : 'Learn'}

                </button>


                <button
                  onClick={() =>
                    navigate(
                      'quiz',
                      {
                        subject,
                        topic
                      }
                    )
                  }
                  className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-medium"
                >

                  Test

                </button>

              </div>

            </div>

          )
        )}

      </div>

    </div>

  );

}


// ==========================================
// STUDY SESSION
// ==========================================

function StudySessionView({
  subject,
  topic,
  mode,
  navigate,
  setLoadingMsg,
  setError
}) {

  const [material, setMaterial] =
    useState(null);


  useEffect(() => {

    let isMounted = true;


    const fetchLesson = async () => {

      setLoadingMsg(
        `AI Teacher is preparing ${
          mode === 'revise'
            ? 'revision'
            : 'lesson'
        } on ${topic.name}...`
      );

      setError(null);


      try {

        const prompt = `
Teach "${topic.name}" from "${subject.name}".

Provide:
1. Simple explanation
2. Academic explanation
3. Key terms
4. Process steps if applicable
5. Accurate analogy
6. Key takeaways
7. One quick-check question

Keep the lesson focused and suitable for a student.
`;


        const systemInstruction = `
You are an expert academic tutor.

Be scientifically accurate.
Do not invent facts.
Return only valid JSON matching the supplied schema.
`;


        const data =
          await callGemini(
            prompt,
            systemInstruction,
            teachTopicSchema
          );


        if (isMounted) {

          setMaterial(data);
          setLoadingMsg(null);

        }

      } catch (err) {

        console.error(
          "Lesson error:",
          err
        );

        if (isMounted) {

          setLoadingMsg(null);

          setError(
            err?.message ||
            "Failed to load lesson."
          );

        }

      }

    };


    fetchLesson();


    return () => {
      isMounted = false;
    };

  }, [
    topic.name,
    subject.name,
    mode
  ]);


  if (!material) {
    return null;
  }


  return (

    <div className="max-w-4xl mx-auto">

      <button
        onClick={() =>
          navigate(
            'subjectDetail',
            { subject }
          )
        }
        className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6"
      >

        <ArrowLeft className="w-4 h-4" />

        Back to {subject.name}

      </button>


      <div className="bg-white rounded-3xl p-6 md:p-10 border border-slate-200 shadow-sm mb-6">

        <div className="flex items-center justify-between mb-4">

          <div
            className={`inline-flex px-3 py-1 rounded-full text-sm font-bold ${
              mode === 'revise'
                ? 'bg-rose-50 text-rose-600'
                : 'bg-indigo-50 text-indigo-600'
            }`}
          >

            {mode === 'revise'
              ? 'Targeted Revision'
              : 'Learning Session'}

          </div>


          <span className="text-sm font-medium text-slate-500">

            ⏱ Est:
            {' '}
            {mode === 'revise'
              ? topic.revisionTime
              : topic.learnTime}
            {' '}
            mins

          </span>

        </div>


        <h2 className="text-3xl font-bold text-slate-900 mb-8">
          {topic.name}
        </h2>


        <div className="space-y-8">

          <section>

            <h3 className="text-lg font-bold text-slate-800 mb-3">
              Simple Explanation
            </h3>

            <p className="text-slate-700 leading-relaxed bg-slate-50 p-5 rounded-2xl">
              {material.simpleExplanation}
            </p>

          </section>


          <section>

            <h3 className="text-lg font-bold text-slate-800 mb-3">
              Academic Detail
            </h3>

            <p className="text-slate-800 leading-relaxed bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
              {material.academicExplanation}
            </p>

          </section>


          {material.keyTerms?.length > 0 && (

            <section>

              <h3 className="text-lg font-bold text-slate-800 mb-3">
                Key Terms
              </h3>

              <div className="bg-amber-50 p-5 rounded-2xl border border-amber-100 space-y-3">

                {material.keyTerms.map(
                  (item, index) => (

                    <div key={index}>

                      <span className="font-bold text-amber-900 block">
                        {item.term}
                      </span>

                      <span className="text-sm text-amber-800">
                        {item.definition}
                      </span>

                    </div>

                  )
                )}

              </div>

            </section>

          )}


          {material.processSteps?.length > 0 && (

            <section>

              <h3 className="text-lg font-bold text-slate-800 mb-3">
                Process / Steps
              </h3>

              <ul className="bg-blue-50 p-5 rounded-2xl border border-blue-100 space-y-2">

                {material.processSteps.map(
                  (step, index) => (

                    <li
                      key={index}
                      className="text-sm text-blue-900"
                    >
                      {index + 1}.
                      {' '}
                      {step}
                    </li>

                  )
                )}

              </ul>

            </section>

          )}


          <section>

            <h3 className="text-lg font-bold text-slate-800 mb-3">
              Helpful Analogy
            </h3>

            <p className="text-purple-900 italic bg-purple-50 p-5 rounded-2xl border border-purple-100">
              "{material.analogy}"
            </p>

          </section>


          <section>

            <div className="bg-slate-900 text-white p-6 rounded-2xl">

              <h4 className="font-bold text-lg mb-1">
                Quick Check
              </h4>

              <p className="text-slate-300 text-sm">
                {material.quickCheck}
              </p>

            </div>

          </section>

        </div>

      </div>


      <div className="flex flex-col sm:flex-row gap-4 justify-end">

        <button
          onClick={() =>
            navigate(
              'subjectDetail',
              { subject }
            )
          }
          className="px-6 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-medium"
        >

          End Session

        </button>


        <button
          onClick={() =>
            navigate(
              'quiz',
              {
                subject,
                topic
              }
            )
          }
          className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium"
        >

          Take Topic Quiz

        </button>

      </div>

    </div>

  );

}


// ==========================================
// QUIZ
// ==========================================

function QuizView({
  user,
  subject,
  topic,
  topics,
  navigate,
  setLoadingMsg,
  setError
}) {

  const [quiz, setQuiz] =
    useState(null);

  const [currentQ, setCurrentQ] =
    useState(0);

  const [answers, setAnswers] =
    useState({});

  const [submitted, setSubmitted] =
    useState(false);

  const [resultData, setResultData] =
    useState(null);


  useEffect(() => {

    let isMounted = true;


    const fetchQuiz = async () => {

      setLoadingMsg(
        `Generating practice test for ${topic.name}...`
      );

      setError(null);


      try {

        const prompt = `
Create a 5-question multiple-choice quiz testing "${topic.name}" in "${subject.name}".

Questions should be challenging but fair.

Return exactly the structure requested by the JSON schema.
`;


        const systemInstruction = `
You are an expert examiner.

Create accurate educational multiple-choice questions.
Do not invent incorrect scientific facts.
Return only valid JSON matching the supplied schema.
`;


        const data =
          await callGemini(
            prompt,
            systemInstruction,
            generateQuizSchema
          );


        if (
          !data ||
          !Array.isArray(
            data.questions
          )
        ) {

          throw new Error(
            "AI returned an invalid quiz."
          );

        }


        if (isMounted) {

          setQuiz(
            data.questions
          );

          setLoadingMsg(null);

        }

      } catch (err) {

        console.error(
          "Quiz error:",
          err
        );

        if (isMounted) {

          setLoadingMsg(null);

          setError(
            err?.message ||
            "Failed to generate quiz."
          );

        }

      }

    };


    fetchQuiz();


    return () => {
      isMounted = false;
    };

  }, [
    topic.name,
    subject.name
  ]);


  const handleOptionSelect = (
    qIndex,
    option
  ) => {

    if (submitted) {
      return;
    }

    setAnswers({
      ...answers,
      [qIndex]: option
    });

  };


  const handleSubmit = async () => {

    if (
      !quiz ||
      Object.keys(answers).length <
        quiz.length
    ) {

      setError(
        "Please answer all questions before submitting."
      );

      return;
    }


    setError(null);

    setLoadingMsg(
      "Grading test..."
    );


    let calculatedScore = 0;

    const mistakes = [];


    quiz.forEach(
      (question, index) => {

        if (
          answers[index] ===
          question.correctAnswer
        ) {

          calculatedScore++;

        } else {

          mistakes.push({

            question:
              question.question,

            selected:
              answers[index],

            correct:
              question.correctAnswer,

            explanation:
              question.explanation

          });

        }

      }
    );


    const percentScore =
      Math.round(
        (calculatedScore /
          quiz.length) *
          100
      );


    setResultData({
      score: percentScore,
      mistakes
    });

    setSubmitted(true);


    try {

      await addDoc(
        collection(
          db,
          'artifacts',
          appId,
          'users',
          user.uid,
          'quizAttempts'
        ),
        {

          subjectId:
            subject.id,

          topicId:
            topic.id,

          score:
            calculatedScore,

          total:
            quiz.length,

          percent:
            percentScore,

          date:
            serverTimestamp()

        }
      );


      const topicRef =
        doc(
          db,
          'artifacts',
          appId,
          'users',
          user.uid,
          'topics',
          topic.id
        );


      await setDoc(
        topicRef,
        {
          status:
            'completed',

          lastScore:
            percentScore

        },
        {
          merge: true
        }
      );


    } catch (err) {

      console.error(
        "Failed to save progress:",
        err
      );

    } finally {

      setLoadingMsg(null);

    }

  };


  if (!quiz) {
    return null;
  }


  if (
    submitted &&
    resultData
  ) {

    const isPass =
      resultData.score >= 70;


    const subTopics =
      topics.filter(
        t =>
          t.subjectId ===
          subject.id
      );


    const nextTopic =
      subTopics.find(
        t =>
          t.status !==
            'completed' &&
          t.id !== topic.id
      );


    return (

      <div className="max-w-3xl mx-auto mt-4">

        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm text-center mb-8">

          <div
            className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 ${
              isPass
                ? 'bg-emerald-100 text-emerald-500'
                : 'bg-rose-100 text-rose-500'
            }`}
          >

            <Target className="w-10 h-10" />

          </div>


          <h2 className="text-4xl font-bold text-slate-900 mb-2">
            Score: {resultData.score}%
          </h2>


          <p className="text-slate-600 mb-6">
            {isPass
              ? "Great job! You have a solid understanding."
              : "More practice needed. We recommend a focused revision session."}
          </p>


          <div className="flex flex-col sm:flex-row justify-center gap-4">

            {!isPass && (

              <button
                onClick={() =>
                  navigate(
                    'study',
                    {
                      subject,
                      topic,
                      mode: 'revise'
                    }
                  )
                }
                className="bg-rose-600 text-white px-6 py-3 rounded-xl font-medium"
              >

                Start Revision Now

              </button>

            )}


            {isPass &&
              nextTopic && (

                <button
                  onClick={() =>
                    navigate(
                      'study',
                      {
                        subject,
                        topic:
                          nextTopic,
                        mode:
                          'learn'
                      }
                    )
                  }
                  className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium"
                >

                  Next Topic:
                  {' '}
                  {nextTopic.name}

                </button>

              )}


            <button
              onClick={() =>
                navigate(
                  'subjectDetail',
                  { subject }
                )
              }
              className="bg-slate-100 text-slate-700 border border-slate-300 px-6 py-3 rounded-xl font-medium"
            >

              Back to Plan

            </button>

          </div>

        </div>


        {!isPass &&
          resultData.mistakes.length >
            0 && (

            <div className="mb-8">

              <h3 className="text-xl font-bold text-rose-800 mb-4">
                Specific Weak Areas to Review
              </h3>


              <div className="space-y-4">

                {resultData.mistakes.map(
                  (mistake, index) => (

                    <div
                      key={index}
                      className="bg-rose-50 p-5 rounded-2xl border border-rose-200"
                    >

                      <p className="font-semibold text-slate-900 mb-2">
                        Q: {mistake.question}
                      </p>

                      <p className="text-sm text-rose-700 mb-1">
                        Your answer:
                        {' '}
                        {mistake.selected}
                      </p>

                      <p className="text-sm text-emerald-700 font-bold mb-3">
                        Correct answer:
                        {' '}
                        {mistake.correct}
                      </p>

                      <p className="text-sm text-slate-700 bg-white p-3 rounded-xl border border-rose-100">
                        {mistake.explanation}
                      </p>

                    </div>

                  )
                )}

              </div>

            </div>

          )}

      </div>

    );

  }


  const q =
    quiz[currentQ];


  return (

    <div className="max-w-2xl mx-auto mt-4">

      <div className="flex justify-between items-center mb-6">

        <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
          Test Mode
        </span>

        <span className="text-sm font-medium text-slate-500">
          Est: {topic.practiceTime}m
        </span>

      </div>


      <div className="w-full bg-slate-200 rounded-full h-2 mb-8">

        <div
          className="bg-indigo-600 h-2 rounded-full"
          style={{
            width:
              `${((currentQ + 1) /
                quiz.length) *
                100}%`
          }}
        />

      </div>


      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm mb-6">

        <span className="text-sm font-bold text-slate-400 block mb-2">
          Question {currentQ + 1} of {quiz.length}
        </span>


        <h3 className="text-xl font-semibold text-slate-900 mb-6">
          {q.question}
        </h3>


        <div className="space-y-3">

          {q.options.map(
            (option, index) => {

              const isSelected =
                answers[currentQ] ===
                option;


              return (

                <button
                  key={index}
                  onClick={() =>
                    handleOptionSelect(
                      currentQ,
                      option
                    )
                  }
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-medium'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50 text-slate-700'
                  }`}
                >

                  {option}

                </button>

              );

            }
          )}

        </div>

      </div>


      <div className="flex justify-between">

        <button
          disabled={currentQ === 0}
          onClick={() =>
            setCurrentQ(
              prev => prev - 1
            )
          }
          className="px-6 py-3 text-slate-600 disabled:opacity-50 font-medium"
        >

          Previous

        </button>


        {currentQ ===
        quiz.length - 1 ? (

          <button
            onClick={handleSubmit}
            className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-medium"
          >

            Submit Test

          </button>

        ) : (

          <button
            onClick={() =>
              setCurrentQ(
                prev => prev + 1
              )
            }
            className="px-8 py-3 bg-slate-900 text-white rounded-xl font-medium"
          >

            Next

          </button>

        )}

      </div>

    </div>

  );

}


// ==========================================
// PROGRESS
// ==========================================

function ProgressView({
  stats,
  navigate,
  subjects
}) {

  return (

    <div className="max-w-5xl mx-auto space-y-8">

      <div>

        <h2 className="text-3xl font-bold text-slate-900">
          Performance Analytics
        </h2>

      </div>


      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">

          <p className="text-slate-500 text-sm font-medium mb-1">
            Mastery
          </p>

          <p className="text-2xl font-bold text-blue-600">
            {stats.progress}%
          </p>

        </div>


        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">

          <p className="text-slate-500 text-sm font-medium mb-1">
            Avg Score
          </p>

          <p className="text-2xl font-bold text-indigo-600">
            {stats.avgScore}%
          </p>

        </div>


        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">

          <p className="text-slate-500 text-sm font-medium mb-1">
            Strong Topics
          </p>

          <p className="text-2xl font-bold text-emerald-600">
            {stats.strongTopics.length}
          </p>

        </div>


        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">

          <p className="text-slate-500 text-sm font-medium mb-1">
            Weak Topics
          </p>

          <p className="text-2xl font-bold text-rose-600">
            {stats.weakTopics.length}
          </p>

        </div>

      </div>


      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 shadow-sm">

          <h3 className="text-lg font-bold text-emerald-800 mb-4">
            Strongest Areas (≥70%)
          </h3>


          {stats.strongTopics.length === 0 ? (

            <p className="text-emerald-700/80 text-sm">
              Complete some tests to build your strong topics list.
            </p>

          ) : (

            <div className="space-y-3">

              {stats.strongTopics.map(
                topic => (

                  <div
                    key={topic.id}
                    className="bg-white p-3 rounded-xl flex justify-between items-center shadow-sm"
                  >

                    <h4 className="font-semibold text-slate-900 text-sm">
                      {topic.name}
                    </h4>

                    <span className="font-bold text-emerald-600">
                      {topic.lastScore}%
                    </span>

                  </div>

                )
              )}

            </div>

          )}

        </div>


        <div className="bg-rose-50 p-6 rounded-2xl border border-rose-100 shadow-sm">

          <h3 className="text-lg font-bold text-rose-800 mb-4">
            Needs Revision (&lt;70%)
          </h3>


          {stats.weakTopics.length === 0 ? (

            <p className="text-rose-600/80 text-sm">
              You don't have any weak topics right now. Great job!
            </p>

          ) : (

            <div className="space-y-3">

              {stats.weakTopics.map(
                topic => (

                  <div
                    key={topic.id}
                    className="bg-white p-3 rounded-xl flex justify-between items-center shadow-sm"
                  >

                    <h4 className="font-semibold text-slate-900 text-sm">
                      {topic.name}
                    </h4>


                    <button
                      onClick={() =>
                        navigate(
                          'study',
                          {
                            subject:
                              subjects.find(
                                s =>
                                  s.id ===
                                  topic.subjectId
                              ),

                            topic,

                            mode:
                              'revise'
                          }
                        )
                      }
                      className="text-xs bg-rose-100 text-rose-700 px-3 py-1.5 rounded-lg font-bold"
                    >

                      Revise Now

                    </button>

                  </div>

                )
              )}

            </div>

          )}

        </div>

      </div>

    </div>

  );

}
