import React, { useState, useEffect } from 'react';
import { sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { 
  collection, doc, addDoc, getDocs, updateDoc, deleteDoc, 
  query, orderBy, serverTimestamp, Timestamp 
} from 'firebase/firestore';
import { auth, db } from './firebase';

// Types
interface Project {
  id: string;
  name: string;
  url: string;
  framework: string;
  status: string;
  lastDeployed: string;
  repo?: string;
}

interface User {
  email: string;
}

interface Template {
  id: string;
  name: string;
  framework: string;
  icon: string;
  buildCommand: string;
  outputDir: string;
  description: string;
}

const App: React.FC = () => {
  // Auth & App State
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  
  // View control: landing (marketing) or dashboard (Vercel-style app)
  const [view, setView] = useState<'landing' | 'dashboard'>('landing');

  // Auth Modal State (Pure Passwordless Email Link)
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authStep, setAuthStep] = useState<'email' | 'sent'>('email');
  const [emailInput, setEmailInput] = useState('');
  const [isSendingLink, setIsSendingLink] = useState(false);

  // Vercel-like New Project Flow
  const [showNewProject, setShowNewProject] = useState(false);
  const [importRepoUrl, setImportRepoUrl] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [projectName, setProjectName] = useState('');
  const [framework, setFramework] = useState('');
  const [buildCommand, setBuildCommand] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState(0);
  const [deployStep, setDeployStep] = useState('');
  const [deployedProject, setDeployedProject] = useState<Project | null>(null);

  // Toast
  const [successToast, setSuccessToast] = useState<{ message: string; type?: string } | null>(null);

  // Closable notice bar
  const [noticeVisible, setNoticeVisible] = useState(true);

  // Firestore loading state
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  // Note: We still use localStorage only for the temporary emailForSignIn during passwordless flow.

  // === Real Firestore helpers for projects ===
  const loadProjectsFromFirestore = async (uid: string) => {
    setIsLoadingProjects(true);
    try {
      const projectsRef = collection(db, 'users', uid, 'projects');
      const q = query(projectsRef, orderBy('lastDeployed', 'desc'));
      const snapshot = await getDocs(q);

      const loaded: Project[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          name: data.name,
          url: data.url,
          framework: data.framework,
          status: data.status || 'Live',
          lastDeployed: data.lastDeployed instanceof Timestamp 
            ? data.lastDeployed.toDate().toISOString() 
            : (data.lastDeployed || new Date().toISOString()),
          repo: data.repo,
        };
      });

      setProjects(loaded);
    } catch (error) {
      console.error("Firestore load projects error:", error);
      showToast("Could not load projects from the cloud.", "error");
    }
    setIsLoadingProjects(false);
  };

  const saveProjectToFirestore = async (uid: string, projectData: Omit<Project, 'id'> & { id?: string }) => {
    try {
      const projectsRef = collection(db, 'users', uid, 'projects');
      const docRef = await addDoc(projectsRef, {
        ...projectData,
        lastDeployed: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (error) {
      console.error("Firestore save project error:", error);
      showToast("Project created but failed to sync to cloud.", "error");
      return null;
    }
  };

  const updateProjectInFirestore = async (uid: string, projectId: string, updates: Partial<Project>) => {
    try {
      const projectRef = doc(db, 'users', uid, 'projects', projectId);
      await updateDoc(projectRef, {
        ...updates,
        lastDeployed: serverTimestamp(),
      });
    } catch (error) {
      console.error("Firestore update error:", error);
    }
  };

  const deleteProjectFromFirestore = async (uid: string, projectId: string) => {
    try {
      const projectRef = doc(db, 'users', uid, 'projects', projectId);
      await deleteDoc(projectRef);
    } catch (error) {
      console.error("Firestore delete error:", error);
    }
  };

  // Templates (Vercel style)
  const templates: Template[] = [
    { 
      id: 'vite-react', name: 'Vite + React', framework: 'Vite', 
      icon: '⚛️', buildCommand: 'npm run build', outputDir: 'dist',
      description: 'Modern React with Vite' 
    },
    { 
      id: 'nextjs', name: 'Next.js', framework: 'Next.js', 
      icon: '▲', buildCommand: 'npm run build', outputDir: '.next',
      description: 'Full-stack React framework' 
    },
    { 
      id: 'static', name: 'Static Site', framework: 'Static', 
      icon: '📄', buildCommand: 'npm run build', outputDir: 'dist',
      description: 'HTML, CSS & JS' 
    },
    { 
      id: 'node-api', name: 'Node.js API', framework: 'Node', 
      icon: '🟢', buildCommand: 'npm run build', outputDir: 'dist',
      description: 'Serverless-ready API' 
    },
    { 
      id: 'astro', name: 'Astro', framework: 'Astro', 
      icon: '🌌', buildCommand: 'npm run build', outputDir: 'dist',
      description: 'Content-focused sites' 
    },
    { 
      id: 'svelte', name: 'SvelteKit', framework: 'Svelte', 
      icon: '🔥', buildCommand: 'npm run build', outputDir: 'build',
      description: 'Blazing fast UI' 
    }
  ];

  // Real Firebase Auth + Firestore listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser && firebaseUser.email) {
        const user: User = { email: firebaseUser.email };
        setCurrentUser(user);
        setLoggedIn(true);
        setView('dashboard');

        // Load projects from Firestore
        await loadProjectsFromFirestore(firebaseUser.uid);
      } else {
        // No user signed in via Firebase
        setLoggedIn(false);
        setCurrentUser(null);
        setProjects([]);
        setView('landing');
      }
    });

    return () => unsubscribe();
  }, []);

  // Handle completing the passwordless email link sign-in
  useEffect(() => {
    const completeEmailLinkSignIn = async () => {
      if (isSignInWithEmailLink(auth, window.location.href)) {
        let email = window.localStorage.getItem('sitenet_emailForSignIn');
        
        if (!email) {
          email = window.prompt('Please confirm the email you used to request the sign-in link');
        }

        if (email) {
          try {
            // Complete the sign in with Firebase
            await signInWithEmailLink(auth, email, window.location.href);
            window.localStorage.removeItem('sitenet_emailForSignIn');

            // Clean the URL
            window.history.replaceState({}, document.title, window.location.pathname);

            // Force the UI update immediately (in case listener is delayed)
            const currentUser = auth.currentUser;
            if (currentUser && currentUser.email) {
              const user: User = { email: currentUser.email };
              setCurrentUser(user);
              setLoggedIn(true);
              setView('dashboard');
              
              // Load projects from Firestore right away
              await loadProjectsFromFirestore(currentUser.uid);
            }

            showToast('Successfully signed in via email link!');
          } catch (error: any) {
            console.error('Email link sign-in error:', error);
            showToast('Failed to complete sign-in. The link may have expired or the email did not match.', 'error');
          }
        } else {
          showToast('Sign-in link detected but no email provided.', 'error');
        }
      }
    };
    completeEmailLinkSignIn();
  }, []);

  const showToast = (message: string, type: string = 'success') => {
    setSuccessToast({ message, type });
    setTimeout(() => setSuccessToast(null), 3200);
  };

  // === AUTHENTICATION (Passwordless Email Link) ===
  const openAuth = () => {
    setAuthModalOpen(true);
    setAuthStep('email');
    setEmailInput('');
  };

  const closeAuth = () => {
    setAuthModalOpen(false);
    setAuthStep('email');
    setEmailInput('');
    setIsSendingLink(false);
  };

  // Real Passwordless Sign-in Link (Firebase Email Link)
  const sendSignInLink = async () => {
    if (!emailInput || !emailInput.includes('@')) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    setIsSendingLink(true);

    try {
      const actionCodeSettings = {
        // The URL to redirect back to. Must match an authorized domain in Firebase Console.
        url: `${window.location.origin}${window.location.pathname}`,
        handleCodeInApp: true,
      };

      await sendSignInLinkToEmail(auth, emailInput, actionCodeSettings);

      // Store the email locally — Firebase needs it when completing the sign-in
      window.localStorage.setItem('sitenet_emailForSignIn', emailInput);

      console.log(`[SiteNet] Passwordless sign-in link sent to ${emailInput}`);

      setIsSendingLink(false);
      setAuthStep('sent');

      showToast('Sign-in link sent! Check your email.');
    } catch (error: any) {
      console.error('Firebase passwordless error:', error);
      setIsSendingLink(false);
      showToast('Failed to send sign-in link. Make sure your domain is authorized in Firebase Console.', 'error');
    }
  };

  const resendSignInLink = () => {
    setAuthStep('email');
    sendSignInLink();
  };

  const handleLogout = () => {
    localStorage.removeItem('sitenet_user');
    // Keep projects in localDB for demo return
    setLoggedIn(false);
    setCurrentUser(null);
    setView('landing');
    setProjects([]);
    setShowNewProject(false);
    setDeployedProject(null);
    showToast('Signed out successfully');
  };

  // === VERCEL-STYLE NEW PROJECT CREATION ===
  const openNewProject = () => {
    if (!loggedIn) {
      openAuth();
      return;
    }
    setShowNewProject(true);
    setImportRepoUrl('');
    setSelectedTemplate(null);
    setProjectName('');
    setFramework('');
    setBuildCommand('');
    setOutputDir('');
    setDeployedProject(null);
  };

  const closeNewProject = () => {
    setShowNewProject(false);
    setDeployedProject(null);
    setIsDeploying(false);
    setDeployProgress(0);
  };

  // Select a template (like Vercel)
  const selectTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setFramework(template.framework);
    setBuildCommand(template.buildCommand);
    setOutputDir(template.outputDir);

    // Smart default project name
    const defaultName = template.id.replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 7);
    setProjectName(defaultName);
  };

  // Import Git flow (Vercel style)
  const handleImportRepo = () => {
    if (!importRepoUrl.trim()) {
      showToast('Enter a repository URL', 'error');
      return;
    }

    // Parse a name from the URL
    const repoMatch = importRepoUrl.match(/\/([^/]+?)(?:\.git)?$/);
    const extractedName = repoMatch ? repoMatch[1] : 'imported-project';

    setProjectName(extractedName.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
    setFramework('Vite'); // Default
    setBuildCommand('npm run build');
    setOutputDir('dist');
    setSelectedTemplate(null);

    showToast('Repository imported. Configure your project below.');
  };

  // Deploy simulation — exactly like Vercel
  const startDeployment = async () => {
    if (!projectName.trim()) {
      showToast('Project name is required', 'error');
      return;
    }

    setIsDeploying(true);
    setDeployProgress(0);
    setDeployedProject(null);

    const steps = [
      { progress: 12, step: 'Cloning repository from GitHub...' },
      { progress: 28, step: 'Installing dependencies...' },
      { progress: 47, step: 'Running build command...' },
      { progress: 68, step: 'Optimizing assets & edge functions...' },
      { progress: 84, step: 'Deploying to global network (macrofox.org)...' },
      { progress: 100, step: 'Deployment complete!' }
    ];

    for (const step of steps) {
      setDeployStep(step.step);
      setDeployProgress(step.progress);
      await new Promise(resolve => setTimeout(resolve, 620));
    }

    // Create the new project
    const slug = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const tempId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const newProjectData: Omit<Project, 'id'> = {
      name: projectName,
      url: `${slug}.sitenet.macrofox.org`,
      framework: framework || 'Vite',
      status: 'Live',
      lastDeployed: new Date().toISOString(),
      repo: importRepoUrl || 'template'
    };

    const firebaseUser = auth.currentUser;
    if (firebaseUser) {
      // Actually save to Firestore
      const newId = await saveProjectToFirestore(firebaseUser.uid, newProjectData);
      const finalProject: Project = {
        id: newId || tempId,
        ...newProjectData,
      };

      // Optimistically update UI
      setProjects(prev => [finalProject, ...prev]);
      setDeployedProject(finalProject);
    } else {
      // Fallback (shouldn't happen)
      const finalProject: Project = { id: tempId, ...newProjectData };
      setProjects(prev => [finalProject, ...prev]);
      setDeployedProject(finalProject);
    }

    setIsDeploying(false);
    showToast(`🚀 Deployed successfully to ${newProjectData.url}`);
  };

  // Quick actions on deployed projects
  const visitProject = (project: Project) => {
    // In real: Would go to the live site
    window.open(`https://${project.url}`, '_blank');
    showToast(`Opening ${project.url}`);
  };

  const redeployProject = async (project: Project) => {
    showToast('Redeploying...');

    const firebaseUser = auth.currentUser;
    if (firebaseUser && project.id) {
      await updateProjectInFirestore(firebaseUser.uid, project.id, {
        status: 'Live',
      });
    }

    await new Promise(r => setTimeout(r, 850));

    // Update local state
    setProjects(prev =>
      prev.map(p =>
        p.id === project.id
          ? { ...p, lastDeployed: new Date().toISOString(), status: 'Live' }
          : p
      )
    );

    showToast('Redeployed successfully!');
  };

  const deleteProject = async (id: string) => {
    if (!confirm('Delete this project?')) return;

    const firebaseUser = auth.currentUser;
    if (firebaseUser) {
      await deleteProjectFromFirestore(firebaseUser.uid, id);
    }

    setProjects(prev => prev.filter(p => p.id !== id));
    showToast('Project deleted');
  };

  // Switch back to marketing view (but keep logged in)
  const goToMarketing = () => {
    setView('landing');
  };

  // If user is logged in, "Client Login" becomes Dashboard access
  const handleNavAuthClick = () => {
    if (loggedIn) {
      setView('dashboard');
      setShowNewProject(false);
    } else {
      openAuth();
    }
  };

  // Original scroll helper (for landing only)
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // === RENDER ===

  // If in dashboard mode (logged in)
  if (loggedIn && view === 'dashboard') {
    return (
      <div className="min-h-screen bg-[#0d1117] text-white">
        {/* Top Nav — Vercel style */}
        <nav className="sticky top-0 z-50 bg-[#0d1117]/95 backdrop-blur-xl border-b border-white/10">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div onClick={() => { setView('dashboard'); setShowNewProject(false); }} className="flex items-center gap-3 cursor-pointer">
                <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center">
                  <span className="text-[#0d1117] text-lg font-bold">S</span>
                </div>
                <div>
                  <span className="font-semibold text-xl tracking-tight">SiteNet</span>
                  <span className="text-white/60 text-xs ml-1.5 font-mono">HOSTING</span>
                </div>
              </div>
              <div className="hidden sm:block text-xs px-2.5 py-0.5 rounded bg-white/5 text-white/60">sitnet.macrofox.org</div>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <button 
                onClick={openNewProject} 
                className="btn-glow px-5 py-2 rounded-xl bg-white text-[#0d1117] font-semibold hover:bg-white/90 active:scale-[0.985] transition-all flex items-center gap-2"
              >
                + New Project
              </button>

              <div className="flex items-center gap-2 pl-4 border-l border-white/10">
                <div className="text-right">
                  <div className="text-xs text-white/70">Signed in as</div>
                  <div className="font-medium text-sm">{currentUser?.email}</div>
                </div>
                <button 
                  onClick={handleLogout}
                  className="ml-2 px-4 py-1.5 text-xs rounded-lg border border-white/20 hover:bg-white/5 transition"
                >
                  Sign out
                </button>
              </div>

              <button onClick={goToMarketing} className="text-xs px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/5">
                Marketing Site
              </button>
            </div>
          </div>
        </nav>

        {/* DASHBOARD CONTENT — Vercel Style */}
        <div className="max-w-7xl mx-auto px-6 py-10">
          {!showNewProject ? (
            <>
              {/* Dashboard Header */}
              <div className="flex items-end justify-between mb-8">
                <div>
                  <h1 className="text-5xl font-semibold tracking-[-2px]">Projects</h1>
                  <p className="text-white/60 mt-1">Deployments on the SiteNet global edge network</p>
                </div>
                <button onClick={openNewProject} className="btn-glow px-8 py-3 rounded-2xl bg-white text-[#0d1117] font-semibold flex items-center gap-2">
                  + New Project
                </button>
              </div>

              {/* Projects Grid — Vercel style */}
              {isLoadingProjects ? (
                <div className="border border-white/10 rounded-3xl p-16 text-center bg-[#161b22]">
                  <div className="mx-auto w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin mb-4" />
                  <p className="text-white/60">Loading your projects from the cloud...</p>
                </div>
              ) : projects.length === 0 ? (
                <div className="border border-white/10 rounded-3xl p-16 text-center bg-[#161b22]">
                  <div className="text-6xl mb-4">🚀</div>
                  <h3 className="text-3xl font-semibold mb-2">No projects yet</h3>
                  <p className="text-white/60 mb-8 max-w-xs mx-auto">Create your first project and deploy instantly to the global network.</p>
                  <button onClick={openNewProject} className="px-9 py-3 bg-white text-[#0d1117] rounded-2xl font-semibold">Create your first project</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {projects.map((project) => (
                    <div key={project.id} className="bg-[#161b22] border border-white/10 rounded-3xl p-6 card-hover group">
                      <div className="flex justify-between">
                        <div>
                          <div className="font-semibold text-xl tracking-tight">{project.name}</div>
                          <a 
                            href={`https://${project.url}`} 
                            target="_blank" 
                            onClick={(e) => { e.preventDefault(); visitProject(project); }}
                            className="text-white/80 hover:text-white hover:underline text-sm font-mono mt-0.5 block"
                          >
                            {project.url}
                          </a>
                        </div>
                        <div className="text-right">
                          <div className="inline-block text-xs px-3 py-px rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">{project.status}</div>
                        </div>
                      </div>

                      <div className="mt-8 flex items-center justify-between text-sm">
                        <div>
                          <div className="text-white/50 text-xs">FRAMEWORK</div>
                          <div className="font-medium">{project.framework}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-white/50 text-xs">LAST DEPLOY</div>
                          <div className="font-mono text-xs">{new Date(project.lastDeployed).toLocaleDateString()}</div>
                        </div>
                      </div>

                      <div className="mt-7 pt-5 border-t border-white/10 flex gap-2">
                        <button onClick={() => visitProject(project)} className="flex-1 py-2 text-sm rounded-xl bg-white/5 hover:bg-white/10 transition font-medium">Visit Site</button>
                        <button onClick={() => redeployProject(project)} className="flex-1 py-2 text-sm rounded-xl border border-white/15 hover:bg-white/5 transition">Redeploy</button>
                        <button onClick={() => deleteProject(project.id)} className="px-4 py-2 text-sm rounded-xl text-red-400/70 hover:text-red-400 hover:bg-red-950/30 transition">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* NEW PROJECT FLOW — Exactly like Vercel */
            <div className="max-w-4xl mx-auto">
              <button onClick={closeNewProject} className="mb-6 text-sm flex items-center gap-2 text-white/60 hover:text-white">← Back to projects</button>

              <h2 className="text-4xl font-semibold tracking-[-1.5px] mb-2">Create a new project</h2>
              <p className="text-white/60 mb-9">Deploy instantly on the fastest cyber infrastructure.</p>

              {!deployedProject && (
                <>
                  {/* Git Import — Vercel style */}
                  <div className="bg-[#161b22] border border-white/10 rounded-3xl p-8 mb-6">
                    <div className="font-semibold mb-3 flex items-center gap-2">
                      <span>Import Git Repository</span>
                    </div>
                    <div className="flex gap-3">
                      <input 
                        value={importRepoUrl}
                        onChange={(e) => setImportRepoUrl(e.target.value)}
                        placeholder="https://github.com/username/repo"
                        className="flex-1 bg-[#0d1117] border border-white/15 rounded-2xl px-5 py-3.5 text-white placeholder:text-white/40 outline-none focus:border-[#00f2fe]"
                      />
                      <button 
                        onClick={handleImportRepo}
                        className="px-8 rounded-2xl bg-white text-[#0d1117] font-semibold active:scale-95"
                      >
                        Import
                      </button>
                    </div>
                    <div className="text-xs text-white/50 mt-2">Connects to your Git provider. Supports GitHub, GitLab, Bitbucket.</div>
                  </div>

                  {/* Templates */}
                  <div>
                    <div className="font-medium mb-4 text-white/80">Or start with a template</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {templates.map((tpl) => (
                        <button
                          key={tpl.id}
                          onClick={() => selectTemplate(tpl)}
                          className={`text-left p-5 rounded-3xl border transition-all ${selectedTemplate?.id === tpl.id ? 'border-white bg-white/5' : 'border-white/10 hover:border-white/30 bg-[#161b22]'}`}
                        >
                          <div className="text-3xl mb-3">{tpl.icon}</div>
                          <div className="font-semibold">{tpl.name}</div>
                          <div className="text-sm text-white/60">{tpl.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Configuration panel (appears after selection or import) */}
                  {(selectedTemplate || importRepoUrl) && (
                    <div className="mt-9 bg-[#161b22] border border-white/10 rounded-3xl p-8">
                      <div className="text-lg font-semibold mb-6">Configure Project</div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-xs uppercase tracking-widest text-white/60 mb-2">PROJECT NAME</label>
                          <input 
                            value={projectName} 
                            onChange={(e) => setProjectName(e.target.value)} 
                            className="w-full bg-[#0d1117] border border-white/15 focus:border-[#00f2fe] px-5 py-3 rounded-2xl font-mono text-lg" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs uppercase tracking-widest text-white/60 mb-2">FRAMEWORK</label>
                          <input 
                            value={framework} 
                            onChange={(e) => setFramework(e.target.value)} 
                            className="w-full bg-[#0d1117] border border-white/15 focus:border-[#00f2fe] px-5 py-3 rounded-2xl" 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                        <div>
                          <label className="block text-xs uppercase tracking-widest text-white/60 mb-2">BUILD COMMAND</label>
                          <input value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)} className="w-full bg-[#0d1117] border border-white/15 focus:border-[#00f2fe] px-5 py-3 rounded-2xl font-mono" />
                        </div>
                        <div>
                          <label className="block text-xs uppercase tracking-widest text-white/60 mb-2">OUTPUT DIRECTORY</label>
                          <input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} className="w-full bg-[#0d1117] border border-white/15 focus:border-[#00f2fe] px-5 py-3 rounded-2xl font-mono" />
                        </div>
                      </div>

                      <button 
                        onClick={startDeployment} 
                        disabled={isDeploying}
                        className="mt-8 w-full py-4 bg-white text-[#0d1117] font-bold rounded-2xl text-lg active:scale-[0.985] disabled:opacity-70 flex items-center justify-center gap-3"
                      >
                        {isDeploying ? 'DEPLOYING...' : 'DEPLOY TO SITENET'}
                      </button>
                      <div className="text-center text-xs mt-3 text-white/50">Free • Instant global deployment • sitenet.macrofox.org</div>
                    </div>
                  )}
                </>
              )}

              {/* Deployment Progress (Vercel style) */}
              {isDeploying && (
                <div className="mt-8 bg-[#161b22] border border-white/10 rounded-3xl p-10 text-center">
                  <div className="mx-auto w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mb-6" />
                  <div className="text-2xl font-semibold mb-2">Deploying {projectName}</div>
                  <div className="text-white/80 font-mono mb-8">{deployStep}</div>
                  
                  <div className="h-1.5 bg-white/10 rounded-full max-w-md mx-auto overflow-hidden">
                    <div className="h-1.5 bg-white transition-all duration-500" style={{ width: `${deployProgress}%` }} />
                  </div>
                  <div className="text-xs text-white/60 mt-2 tabular-nums">{deployProgress}% complete</div>
                </div>
              )}

              {/* Success Screen */}
              {deployedProject && (
                <div className="mt-8 bg-[#161b22] border border-white/30 rounded-3xl p-10 text-center">
                  <div className="text-6xl mb-4">🎉</div>
                  <div className="text-3xl font-semibold tracking-tight mb-1">Deployment successful</div>
                  <div className="text-white/90 font-mono text-xl mb-8">{deployedProject.url}</div>

                  <div className="flex gap-4 justify-center">
                    <button onClick={() => visitProject(deployedProject)} className="btn-glow px-9 py-3.5 rounded-2xl bg-white text-[#0d1117] font-semibold">Visit Live Site</button>
                    <button onClick={closeNewProject} className="px-9 py-3.5 rounded-2xl border border-white/20 hover:bg-white/5">Done — View Projects</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Toast */}
        {successToast && (
          <div className="fixed bottom-6 right-6 z-[80]">
            <div className={`px-5 py-3 rounded-2xl shadow-2xl text-sm border ${successToast.type === 'error' ? 'bg-red-950/90 border-red-900' : 'bg-[#161b22] border-white/15'}`}>
              {successToast.message}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ========== ORIGINAL LANDING PAGE (when not logged in or viewing marketing) ==========
  return (
    <div className="min-h-screen bg-[#0d1117] text-white overflow-x-hidden">
      {/* FLOATING STICKY NOTICE BAR - Now closable */}
      {noticeVisible && (
        <div className="notice-bar fixed top-0 left-0 right-0 z-[60] bg-[#161b22] border-b border-white/10">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-3">
              <div className="text-xl">💡</div>
              <p className="text-[#e2e8f0] leading-tight">
                <span className="font-medium text-white/90">Migration Update:</span> We have successfully upgraded our network node directory to <span className="font-semibold">macrofox.org</span> infrastructure for enhanced permanent global connection speeds.
              </p>
            </div>
            <button 
              onClick={() => setNoticeVisible(false)}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors" 
              aria-label="Dismiss notice"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* STICKY NAV */}
      <nav className="sticky top-[52px] z-50 bg-[#0d1117]/95 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0d1117" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <div className="font-semibold tracking-[-0.5px] text-2xl">SiteNet</div>
              <div className="text-[9px] text-white/60 -mt-1 font-mono tracking-[2px]">SITENET.MACROFOX.ORG</div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-9 text-sm font-medium">
            <button onClick={() => scrollToSection('features')} className="nav-link text-white/80 hover:text-white">Features</button>
            <button onClick={() => scrollToSection('support')} className="nav-link text-white/80 hover:text-white">Support</button>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={handleNavAuthClick}
              className="btn-glow px-6 py-2.5 rounded-full text-sm font-semibold border border-white/20 hover:border-white bg-white/5 hover:bg-white/10 transition-all flex items-center gap-2"
            >
              {loggedIn ? 'Go to Dashboard' : 'Client Login'}
              <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            </button>
            <button onClick={() => { if (!loggedIn) openAuth(); else setView('dashboard'); }} className="md:hidden px-5 py-2 bg-white text-[#0d1117] rounded-full text-sm font-semibold">Get Started</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-14 pb-20 px-6 max-w-5xl mx-auto text-center relative">
        <div className="absolute inset-0 bg-[radial-gradient(#1f2937_0.7px,transparent_1px)] bg-[length:5px_5px] opacity-40 pointer-events-none" />
        
        <div className="relative z-10 pt-12">
          <div className="inline-flex items-center gap-2.5 mb-6 px-4 py-1 rounded-full border border-white/10 bg-white/5 text-xs tracking-[1px] font-medium">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
            </div>
            <span className="text-emerald-400 font-semibold tracking-widest">ALL SYSTEMS OPERATIONAL</span>
          </div>

          <h1 className="text-[56px] md:text-[72px] leading-[1.02] font-semibold tracking-tighter mb-4">
            Cloud Infrastructure<br />Made Simple.<br />
            <span className="text-white/90">Fast. Free. Limitless.</span>
          </h1>

          <p className="max-w-xl mx-auto text-xl text-white/70 mb-10 tracking-tight">
            Enterprise-grade performance at consumer simplicity. 
            Deploy globally in under 45 seconds on the world’s fastest NVMe cloud.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => { if (loggedIn) setView('dashboard'); else openAuth(); }}
              className="btn-glow group px-10 py-[17px] rounded-2xl text-lg font-semibold bg-white text-[#0d1117] hover:bg-white/90 active:scale-[0.985] transition-all shadow-[0_0_15px_rgba(255,255,255,0.2)] flex items-center justify-center gap-3"
            >
              LAUNCH YOUR SERVER
              <span className="text-xl group-hover:translate-x-0.5 transition">→</span>
            </button>
            <button onClick={() => scrollToSection('features')} className="px-8 py-[17px] rounded-2xl text-lg font-semibold border border-white/25 hover:border-white hover:bg-white/5 transition-all">Explore Features</button>
          </div>

          <div className="mt-9 flex justify-center gap-8 text-sm text-white/50">
            <div className="flex items-center gap-2"><div className="text-emerald-400">✓</div> No credit card required</div>
            <div>Instant global deployment</div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-6xl mx-auto px-6 pb-24">
        <div className="text-center mb-12">
          <div className="uppercase tracking-[3px] text-xs text-white/60 font-semibold mb-2">BUILT FOR PERFORMANCE</div>
          <h2 className="text-5xl font-semibold tracking-tighter">Next-generation infrastructure.<br />Zero complexity.</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="card-hover group bg-[#161b22] border border-white/10 rounded-3xl p-9 flex flex-col">
            <div className="w-14 h-14 mb-8 rounded-2xl bg-white flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(255,255,255,0.2)]">
              <svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="#0d1117" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            </div>
            <h3 className="text-3xl tracking-[-1.2px] font-semibold mb-3">Blazing NVMe Speed</h3>
            <p className="text-white/70 leading-relaxed flex-1">Ultra-low latency storage with 1.2M IOPS. 8× faster than legacy SSDs. Your sites and APIs feel instant everywhere.</p>
            <div className="mt-8 pt-6 border-t border-white/10 text-xs uppercase tracking-[2px] text-white/70 font-medium">UP TO 7.4 GB/S READ</div>
          </div>

          <div className="card-hover group bg-[#161b22] border border-white/10 rounded-3xl p-9 flex flex-col">
            <div className="w-14 h-14 mb-8 rounded-2xl bg-white flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(255,255,255,0.2)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0d1117" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
            </div>
            <h3 className="text-3xl tracking-[-1.2px] font-semibold mb-3">99.9% Uptime Shield</h3>
            <p className="text-white/70 leading-relaxed flex-1">Multi-region active-active redundancy. Real-time health monitoring and instant failover. Your uptime is our promise.</p>
            <div className="mt-8 pt-6 border-t border-white/10 flex items-center gap-2 text-xs uppercase tracking-[2px] text-[#7000ff] font-medium">99.97% AVG LAST 12 MO</div>
          </div>

          <div className="card-hover group bg-[#161b22] border border-white/10 rounded-3xl p-9 flex flex-col">
            <div className="w-14 h-14 mb-8 rounded-2xl bg-white flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(255,255,255,0.2)]">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0d1117" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 12l-4-4" /><path d="M19 5l-7 7" /><circle cx="12" cy="12" r="3" /></svg>
            </div>
            <h3 className="text-3xl tracking-[-1.2px] font-semibold mb-3">DDoS Defense Node</h3>
            <p className="text-white/70 leading-relaxed flex-1">Always-on volumetric + application layer defense. 15 Tbps scrubbing capacity. Zero impact on legitimate traffic.</p>
            <div className="mt-8 pt-6 border-t border-white/10 text-xs uppercase tracking-[2px] text-white/70 font-medium">PROTECTED 24/7 • 3.2B ATTACKS MITIGATED</div>
          </div>
        </div>
      </section>

      {/* TRUST BAR + SUPPORT */}
      <div className="max-w-5xl mx-auto px-6 py-10 flex flex-wrap justify-center gap-x-16 gap-y-5 text-center border-b border-white/10">
        <div><div className="font-mono text-3xl tracking-[-1px] font-semibold text-[#00f2fe]">142k</div><div className="text-xs uppercase tracking-[1.5px] text-white/50 mt-px">SERVERS LAUNCHED</div></div>
        <div><div className="font-mono text-3xl tracking-[-1px] font-semibold text-[#00f2fe]">67</div><div className="text-xs uppercase tracking-[1.5px] text-white/50 mt-px">DATA CENTERS WORLDWIDE</div></div>
        <div><div className="font-mono text-3xl tracking-[-1px] font-semibold text-[#00f2fe]">99.97%</div><div className="text-xs uppercase tracking-[1.5px] text-white/50 mt-px">GLOBAL UPTIME</div></div>
      </div>

      <section id="support" className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="max-w-xl mx-auto">
          <h3 className="font-semibold tracking-tight text-4xl mb-4">Need help? We’re here.</h3>
          <p className="text-white/65 text-[17px]">Our infrastructure experts are available around the clock.</p>
          <div className="mt-9">
            <button onClick={openAuth} className="px-8 py-3.5 rounded-2xl border border-[#00f2fe]/60 hover:bg-[#00f2fe]/5 text-[#00f2fe] font-medium transition-all">Sign in to open a ticket</button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/10 bg-[#0a0d12] pt-14 pb-9 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-y-8 text-sm">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5"><div className="w-6 h-6 rounded bg-white"></div><span className="font-semibold tracking-tight">SiteNet Hosting</span></div>
            <div className="text-white/50 text-xs">sitnet.macrofox.org • Global Infrastructure</div>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-1 text-white/60 text-sm">
            <button onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">Features</button>
            <button onClick={() => scrollToSection('support')} className="hover:text-white transition-colors">Support</button>
            <a href="https://afraid.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#00f2fe]">Powered by Free DNS</a>
          </div>
          <div className="text-right text-white/50 text-xs">© 2026 SiteNet Hosting</div>
        </div>
      </footer>

      {/* AUTH MODAL — Pure Passwordless Sign-in (Firebase Email Link) */}
      {authModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6" onClick={closeAuth}>
          <div className="modal bg-[#161b22] rounded-3xl w-full max-w-md border border-white/10 p-9" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between mb-6">
              <div>
                <div className="font-semibold text-3xl tracking-tight">Sign in to SiteNet</div>
                <div className="text-sm text-white/60">Passwordless • Powered by Firebase</div>
              </div>
              <button onClick={closeAuth} className="text-3xl text-white/50 leading-none">×</button>
            </div>

            {authStep === 'email' ? (
              <>
                <div>
                  <label className="text-xs tracking-[2px] font-medium text-white/60 mb-2 block">EMAIL ADDRESS</label>
                  <input 
                    type="email" 
                    value={emailInput} 
                    onChange={(e) => setEmailInput(e.target.value)} 
                    placeholder="you@company.com"
                    className="w-full bg-[#0d1117] border border-white/15 focus:border-[#00f2fe] px-5 py-3.5 rounded-2xl text-lg outline-none" 
                  />
                </div>
                <button 
                  onClick={sendSignInLink} 
                  disabled={isSendingLink}
                  className="mt-6 w-full py-4 bg-white text-[#0d1117] font-semibold rounded-2xl disabled:opacity-70"
                >
                  {isSendingLink ? 'SENDING LINK...' : 'SEND SIGN-IN LINK'}
                </button>
                <div className="text-center mt-4 text-xs text-white/50">We'll email you a secure, passwordless sign-in link. No password required.</div>
              </>
            ) : (
              <>
                <div className="text-center py-4">
                  <div className="text-5xl mb-4">📧</div>
                  <div className="font-semibold text-2xl tracking-tight mb-2">Check your email</div>
                  <p className="text-white/70">
                    A sign-in link has been sent to<br />
                    <span className="font-medium text-white">{emailInput}</span>
                  </p>
                </div>

                <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-4 text-sm text-white/70 mb-6">
                  Click the link in the email to sign in instantly.<br />
                  The link will open this page and complete your login automatically.
                </div>

                <button 
                  onClick={resendSignInLink} 
                  className="w-full py-3 rounded-2xl border border-white/20 hover:bg-white/5 text-sm font-medium mb-2"
                >
                  Resend link
                </button>
                <button 
                  onClick={() => {
                    setAuthStep('email');
                    setEmailInput('');
                  }} 
                  className="w-full py-3 text-sm text-white/60 hover:text-white"
                >
                  Use a different email
                </button>
              </>
            )}
            
            <div className="mt-8 text-center text-[10px] text-white/40">Secured with Firebase Authentication • Hosted on Vercel</div>
          </div>
        </div>
      )}

      {/* Toast */}
      {successToast && (
        <div className="fixed bottom-6 right-6 z-[80]">
          <div className={`px-5 py-3.5 rounded-2xl shadow-2xl text-sm border ${successToast.type === 'error' ? 'bg-red-950 border-red-900 text-red-200' : 'bg-[#161b22] border-white/15'}`}>
            {successToast.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
