import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { PlayCircle, FileText, ChevronRight, BookOpen } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface Subject {
  id: string;
  title: string;
}

interface Chapter {
  id: string;
  title: string;
  subject_id: string;
}

interface Lecture {
  id: string;
  title: string;
  chapter_id: string;
}

export default function CourseView() {
  const { courseId } = useParams();
  const [course, setCourse] = useState<any>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCourseData();
  }, [courseId]);

  const fetchCourseData = async () => {
    setLoading(true);
    const [courseRes, subjectsRes] = await Promise.all([
      supabase.from('courses').select('*').eq('id', courseId).single(),
      supabase.from('subjects').select('*').eq('course_id', courseId)
    ]);

    if (courseRes.data) setCourse(courseRes.data);
    if (subjectsRes.data) {
      setSubjects(subjectsRes.data);
      const subjectIds = subjectsRes.data.map(s => s.id);
      
      const [chaptersRes, lecturesRes] = await Promise.all([
        supabase.from('chapters').select('*').in('subject_id', subjectIds),
        supabase.from('lectures').select('id, title, chapter_id')
      ]);

      if (chaptersRes.data) setChapters(chaptersRes.data);
      if (lecturesRes.data) setLectures(lecturesRes.data);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-12 w-3/4" />
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/dashboard" className="hover:text-primary">Dashboard</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-foreground">{course?.title}</span>
        </div>
        <h1 className="text-4xl font-display font-bold">{course?.title}</h1>
        <p className="text-muted-foreground">{course?.description}</p>
      </div>

      <div className="space-y-6">
        {subjects.map((subject) => (
          <div key={subject.id} className="space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2 text-primary">
              <BookOpen className="w-6 h-6" /> {subject.title}
            </h2>
            
            <div className="grid gap-4">
              {chapters
                .filter(c => c.subject_id === subject.id)
                .map((chapter) => (
                  <div key={chapter.id} className="bg-muted/30 border border-border rounded-2xl overflow-hidden">
                    <div className="p-4 bg-muted/50 border-b border-border font-bold">
                      {chapter.title}
                    </div>
                    <div className="divide-y divide-border">
                      {lectures
                        .filter(l => l.chapter_id === chapter.id)
                        .map((lecture) => (
                          <Link 
                            key={lecture.id} 
                            to={`/lecture/${lecture.id}`}
                            className="flex items-center justify-between p-4 hover:bg-primary/5 transition-colors group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-lg bg-background border border-border group-hover:border-primary/50 transition-colors">
                                <PlayCircle className="w-4 h-4 text-primary" />
                              </div>
                              <span className="font-medium">{lecture.title}</span>
                            </div>
                            <Button variant="ghost" size="sm" className="gap-2">
                              Watch <ChevronRight className="w-4 h-4" />
                            </Button>
                          </Link>
                        ))}
                      {lectures.filter(l => l.chapter_id === chapter.id).length === 0 && (
                        <div className="p-4 text-sm text-muted-foreground italic">
                          No lectures added yet.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
