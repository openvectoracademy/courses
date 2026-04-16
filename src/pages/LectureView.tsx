import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { PlayCircle, FileText, ChevronLeft, ChevronRight, Download, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

interface Lecture {
  id: string;
  title: string;
  yt_id: string;
  pdf_url: string;
  chapter_id: string;
}

export default function LectureView() {
  const { lectureId } = useParams();
  const navigate = useNavigate();
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [nextLecture, setNextLecture] = useState<Lecture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLecture();
  }, [lectureId]);

  const fetchLecture = async () => {
    setLoading(true);
    setError(null);
    
    const { data, error: fetchError } = await supabase
      .from('lectures')
      .select('*')
      .eq('id', lectureId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        setError('Lecture not found or you do not have permission to view it.');
      } else {
        setError(fetchError.message);
      }
      setLoading(false);
      return;
    }

    if (data) {
      setLecture(data);
      
      // Fetch next lecture in the same chapter
      const { data: nextData } = await supabase
        .from('lectures')
        .select('id, title')
        .eq('chapter_id', data.chapter_id)
        .gt('created_at', data.created_at)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      
      setNextLecture(nextData);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <AlertCircle className="w-16 h-16 text-destructive" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground max-w-md">
          {error === 'Lecture not found or you do not have permission to view it.' 
            ? 'This content is restricted to active enrolled students. Please ensure your account is approved.' 
            : error}
        </p>
        <Link to="/dashboard">
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <Link to="/dashboard">
          <Button variant="ghost" className="gap-2">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
        </Link>
      </div>

      {/* Video Player */}
      <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black border border-border shadow-2xl">
        <iframe
          width="100%"
          height="100%"
          src={`https://www.youtube.com/embed/${lecture?.yt_id}?rel=0&modestbranding=1`}
          title={lecture?.title}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        ></iframe>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-3xl font-display font-bold">{lecture?.title}</h1>
          <div className="flex gap-3">
            {lecture?.pdf_url && (
              <a 
                href={lecture.pdf_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-destructive hover:bg-destructive/90 text-white gap-2 h-12 px-6"
              >
                <Download className="w-5 h-5" /> Download PDF
              </a>
            )}
            {nextLecture && (
              <Button 
                onClick={() => navigate(`/lecture/${nextLecture.id}`)}
                variant="outline"
                className="border-primary text-primary hover:bg-primary/10 gap-2 h-12 px-6"
              >
                Next Lecture <ChevronRight className="w-5 h-5" />
              </Button>
            )}
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-muted/30 border border-border">
          <h3 className="font-bold mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-primary" /> Learning Note
          </h3>
          <p className="text-sm text-muted-foreground">
            Watch the full video and take notes. You can download the lecture PDF using the button above for offline study. 
            If you have any questions, please contact your instructor.
          </p>
        </div>
      </div>
    </div>
  );
}
