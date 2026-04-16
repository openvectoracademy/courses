import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Toaster } from '@/components/ui/sonner';
import Navbar from '@/components/Navbar';
import Home from '@/pages/Home';
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import Dashboard from '@/pages/Dashboard';
import CourseView from '@/pages/CourseView';
import LectureView from '@/pages/LectureView';
import AdminDashboard from '@/pages/AdminDashboard';
import { User } from '@supabase/supabase-js';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        checkAdmin(session.user.email);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        checkAdmin(session.user.email);
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkAdmin = async (email?: string) => {
    if (!email) return;
    const { data } = await supabase
      .from('admin_users')
      .select('email')
      .eq('email', email)
      .single();
    setIsAdmin(!!data);
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-primary"></div>
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-background text-foreground font-sans">
        <Navbar user={user} isAdmin={isAdmin} />
        <main className="container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
            <Route path="/signup" element={user ? <Navigate to="/dashboard" /> : <Signup />} />
            
            {/* Student Routes */}
            <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" />} />
            <Route path="/course/:courseId" element={user ? <CourseView /> : <Navigate to="/login" />} />
            <Route path="/lecture/:lectureId" element={user ? <LectureView /> : <Navigate to="/login" />} />
            
            {/* Admin Routes */}
            <Route path="/admin" element={isAdmin ? <AdminDashboard /> : <Navigate to="/" />} />
          </Routes>
        </main>
        <Toaster position="top-center" theme="dark" />
      </div>
    </Router>
  );
}
