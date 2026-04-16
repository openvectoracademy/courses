import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { 
  Plus, Trash2, CheckCircle, XCircle, Download, Upload, 
  Database, Users, BookOpen, Loader2, Image as ImageIcon 
} from 'lucide-react';
import axios from 'axios';

export default function AdminDashboard() {
  const [courses, setCourses] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [newCourse, setNewCourse] = useState({ title: '', description: '', thumbnail_url: '' });
  const [newSubject, setNewSubject] = useState({ course_id: '', title: '' });
  const [newChapter, setNewChapter] = useState({ subject_id: '', title: '' });
  const [newLecture, setNewLecture] = useState({ chapter_id: '', title: '', yt_id: '', pdf_url: '' });
  
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    const [coursesRes, subjectsRes, chaptersRes, studentsRes] = await Promise.all([
      supabase.from('courses').select('*'),
      supabase.from('subjects').select('*'),
      supabase.from('chapters').select('*'),
      supabase.from('profiles').select('*').order('created_at', { ascending: false })
    ]);

    if (coursesRes.data) setCourses(coursesRes.data);
    if (subjectsRes.data) setSubjects(subjectsRes.data);
    if (chaptersRes.data) setChapters(chaptersRes.data);
    if (studentsRes.data) setStudents(studentsRes.data);
    setLoading(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const apiKey = import.meta.env.VITE_IMGBB_API_KEY;
      const res = await axios.post(`https://api.imgbb.com/1/upload?key=${apiKey}`, formData);
      const url = res.data.data.url;
      setNewCourse({ ...newCourse, thumbnail_url: url });
      toast.success('Image uploaded successfully');
    } catch (err) {
      toast.error('Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  const addCourse = async () => {
    const { error } = await supabase.from('courses').insert([newCourse]);
    if (error) toast.error(error.message);
    else {
      toast.success('Course added');
      setNewCourse({ title: '', description: '', thumbnail_url: '' });
      fetchAdminData();
    }
  };

  const addSubject = async () => {
    const { error } = await supabase.from('subjects').insert([newSubject]);
    if (error) toast.error(error.message);
    else {
      toast.success('Subject added');
      setNewSubject({ course_id: '', title: '' });
      fetchAdminData();
    }
  };

  const addChapter = async () => {
    const { error } = await supabase.from('chapters').insert([newChapter]);
    if (error) toast.error(error.message);
    else {
      toast.success('Chapter added');
      setNewChapter({ subject_id: '', title: '' });
      fetchAdminData();
    }
  };

  const addLecture = async () => {
    const { error } = await supabase.from('lectures').insert([newLecture]);
    if (error) toast.error(error.message);
    else {
      toast.success('Lecture added');
      setNewLecture({ chapter_id: '', title: '', yt_id: '', pdf_url: '' });
      fetchAdminData();
    }
  };

  const approveStudent = async (id: string, status: boolean) => {
    const { error } = await supabase.from('profiles').update({ is_active: status }).eq('id', id);
    if (error) toast.error(error.message);
    else {
      toast.success(status ? 'Student approved' : 'Student deactivated');
      fetchAdminData();
    }
  };

  const deleteItem = async (table: string, id: string) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) toast.error(error.message);
    else {
      toast.success('Item deleted');
      fetchAdminData();
    }
  };

  const triggerBackup = async () => {
    try {
      const [courses, subjects, chapters, lectures, profiles] = await Promise.all([
        supabase.from('courses').select('*'),
        supabase.from('subjects').select('*'),
        supabase.from('chapters').select('*'),
        supabase.from('lectures').select('*'),
        supabase.from('profiles').select('*')
      ]);

      let backupText = `SCIENTIA PRIME EMERGENCY BACKUP - ${new Date().toLocaleString()}\n\n`;

      courses.data?.forEach(course => {
        backupText += `COURSE: ${course.title}\n`;
        subjects.data?.filter(s => s.course_id === course.id).forEach(subject => {
          backupText += `  SUBJECT: ${subject.title}\n`;
          chapters.data?.filter(c => c.subject_id === subject.id).forEach(chapter => {
            backupText += `    CHAPTER: ${chapter.title}\n`;
            lectures.data?.filter(l => l.chapter_id === chapter.id).forEach(lecture => {
              backupText += `      - Lec: ${lecture.title} | YT: ${lecture.yt_id} | PDF: ${lecture.pdf_url || 'N/A'}\n`;
            });
          });
        });
        backupText += `\n`;
      });

      backupText += `\nSTUDENTS:\n`;
      profiles.data?.forEach(p => {
        backupText += `- ${p.full_name} (${p.email}) | TX: ${p.transaction_id} | Active: ${p.is_active}\n`;
      });

      const blob = new Blob([backupText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scientia_prime_backup_${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Backup downloaded successfully');
    } catch (err) {
      toast.error('Backup failed');
    }
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold">Admin Panel</h1>
          <p className="text-muted-foreground">Manage your platform content and students.</p>
        </div>
        <Button onClick={triggerBackup} className="bg-primary text-primary-foreground gap-2">
          <Database className="w-4 h-4" /> Emergency Backup (.txt)
        </Button>
      </div>

      <Tabs defaultValue="content" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-8 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="content" className="rounded-lg gap-2">
            <BookOpen className="w-4 h-4" /> Content Management
          </TabsTrigger>
          <TabsTrigger value="students" className="rounded-lg gap-2">
            <Users className="w-4 h-4" /> Student Approval
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="space-y-12">
          {/* Add Course */}
          <Card className="bg-muted/20 border-border">
            <CardHeader>
              <CardTitle>Add New Course</CardTitle>
              <CardDescription>Create a top-level course category.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input 
                  placeholder="Course Title" 
                  value={newCourse.title} 
                  onChange={e => setNewCourse({...newCourse, title: e.target.value})}
                />
                <div className="flex gap-2">
                  <Input 
                    placeholder="Thumbnail URL" 
                    value={newCourse.thumbnail_url} 
                    onChange={e => setNewCourse({...newCourse, thumbnail_url: e.target.value})}
                  />
                  <div className="relative">
                    <input 
                      type="file" 
                      className="absolute inset-0 opacity-0 cursor-pointer" 
                      onChange={handleImageUpload}
                      accept="image/*"
                    />
                    <Button variant="outline" size="icon" disabled={uploading}>
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <Input 
                placeholder="Description" 
                value={newCourse.description} 
                onChange={e => setNewCourse({...newCourse, description: e.target.value})}
              />
              <Button onClick={addCourse} className="w-full bg-primary text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" /> Create Course
              </Button>
            </CardContent>
          </Card>

          {/* Add Subject & Chapter */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="bg-muted/20 border-border">
              <CardHeader><CardTitle>Add Subject</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <select 
                  className="w-full bg-background border border-border rounded-md p-2"
                  value={newSubject.course_id}
                  onChange={e => setNewSubject({...newSubject, course_id: e.target.value})}
                >
                  <option value="">Select Course</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <Input 
                  placeholder="Subject Title" 
                  value={newSubject.title} 
                  onChange={e => setNewSubject({...newSubject, title: e.target.value})}
                />
                <Button onClick={addSubject} className="w-full">Add Subject</Button>
              </CardContent>
            </Card>

            <Card className="bg-muted/20 border-border">
              <CardHeader><CardTitle>Add Chapter</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <select 
                  className="w-full bg-background border border-border rounded-md p-2"
                  value={newChapter.subject_id}
                  onChange={e => setNewChapter({...newChapter, subject_id: e.target.value})}
                >
                  <option value="">Select Subject</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
                <Input 
                  placeholder="Chapter Title" 
                  value={newChapter.title} 
                  onChange={e => setNewChapter({...newChapter, title: e.target.value})}
                />
                <Button onClick={addChapter} className="w-full">Add Chapter</Button>
              </CardContent>
            </Card>
          </div>

          {/* Add Lecture */}
          <Card className="bg-muted/20 border-border">
            <CardHeader><CardTitle>Add Lecture</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <select 
                  className="w-full bg-background border border-border rounded-md p-2"
                  value={newLecture.chapter_id}
                  onChange={e => setNewLecture({...newLecture, chapter_id: e.target.value})}
                >
                  <option value="">Select Chapter</option>
                  {chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <Input 
                  placeholder="Lecture Title" 
                  value={newLecture.title} 
                  onChange={e => setNewLecture({...newLecture, title: e.target.value})}
                />
                <Input 
                  placeholder="YouTube Video ID (e.g. dQw4w9WgXcQ)" 
                  value={newLecture.yt_id} 
                  onChange={e => setNewLecture({...newLecture, yt_id: e.target.value})}
                />
                <Input 
                  placeholder="PDF Link (Optional)" 
                  value={newLecture.pdf_url} 
                  onChange={e => setNewLecture({...newLecture, pdf_url: e.target.value})}
                />
              </div>
              <Button onClick={addLecture} className="w-full bg-primary text-primary-foreground">Add Lecture</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="students">
          <Card className="bg-muted/20 border-border">
            <CardHeader>
              <CardTitle>Student Approval List</CardTitle>
              <CardDescription>Verify transaction IDs and activate student accounts.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Transaction ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell className="font-medium">{student.full_name}</TableCell>
                        <TableCell>{student.email}</TableCell>
                        <TableCell className="font-mono text-xs text-primary">{student.transaction_id}</TableCell>
                        <TableCell>
                          {student.is_active ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 text-green-500 text-[10px] font-bold uppercase">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-[10px] font-bold uppercase">
                              Pending
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          {student.is_active ? (
                            <Button variant="ghost" size="sm" onClick={() => approveStudent(student.id, false)} className="text-destructive">
                              Deactivate
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => approveStudent(student.id, true)} className="text-green-500">
                              Approve
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => deleteItem('profiles', student.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
