import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { BookOpen, Clock, AlertCircle, PlayCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface Course {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
}

interface Profile {
  is_active: boolean;
}

export default function Dashboard() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const [coursesRes, profileRes] = await Promise.all([
        supabase.from('courses').select('*'),
        supabase.from('profiles').select('is_active').eq('id', user.id).single()
      ]);

      if (coursesRes.data) setCourses(coursesRes.data);
      if (profileRes.data) setProfile(profileRes.data);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-display font-bold">My Learning</h1>
        <p className="text-muted-foreground">Access your enrolled courses and continue learning.</p>
      </div>

      {!profile?.is_active && (
        <div className="bg-primary/10 border border-primary/20 rounded-2xl p-6 flex items-start gap-4">
          <AlertCircle className="w-6 h-6 text-primary shrink-0 mt-1" />
          <div className="space-y-1">
            <h3 className="font-bold text-primary">Account Pending Approval</h3>
            <p className="text-sm text-muted-foreground">
              Your account is currently being verified by our team. You will have full access to lectures and PDFs once approved. 
              This usually takes 12-24 hours.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {courses.map((course) => (
          <Card key={course.id} className="overflow-hidden border-border bg-muted/20 hover:border-primary/50 transition-all group">
            <div className="aspect-video relative overflow-hidden">
              <img 
                src={course.thumbnail_url || `https://picsum.photos/seed/${course.id}/800/450`} 
                alt={course.title}
                className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
            </div>
            <CardHeader>
              <CardTitle className="text-xl">{course.title}</CardTitle>
              <CardDescription className="line-clamp-2">{course.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link to={`/course/${course.id}`}>
                <Button className="w-full gap-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground">
                  <PlayCircle className="w-4 h-4" /> View Course
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {courses.length === 0 && (
        <div className="text-center py-24 border-2 border-dashed border-border rounded-3xl">
          <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-xl font-bold">No courses found</h3>
          <p className="text-muted-foreground">Check back later for new content.</p>
        </div>
      )}
    </div>
  );
}
