import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Play, BookOpen, Shield, ArrowRight } from 'lucide-react';

export default function Home() {
  return (
    <div className="flex flex-col gap-24 py-12">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl bg-secondary/30 border border-border p-8 md:p-24 flex flex-col items-center text-center gap-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex flex-col gap-4 max-w-3xl"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium self-center">
            <Shield className="w-3 h-3" />
            Premium Admission Platform
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tight leading-tight">
            Master Your Future with <span className="text-primary">Scientia Prime</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            The most comprehensive and premium learning platform for students. 
            Access high-quality lectures, structured courses, and expert guidance.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="flex flex-wrap justify-center gap-4"
        >
          <Link to="/signup">
            <Button size="lg" className="h-14 px-8 text-lg gap-2 bg-primary hover:bg-primary/90 text-primary-foreground">
              Enroll Now <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="outline" className="h-14 px-8 text-lg gap-2 border-primary/50 hover:bg-primary/10 text-primary">
              <Play className="w-5 h-5 fill-current" /> Watch Demo
            </Button>
          </Link>
        </motion.div>

        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-secondary/20 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />
      </section>

      {/* Features Section */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          {
            icon: <BookOpen className="w-8 h-8 text-primary" />,
            title: "Structured Learning",
            description: "Courses organized by subjects, papers, and chapters for seamless navigation."
          },
          {
            icon: <Play className="w-8 h-8 text-primary" />,
            title: "HD Video Lectures",
            description: "High-quality video content accessible anytime, anywhere on any device."
          },
          {
            icon: <Shield className="w-8 h-8 text-primary" />,
            title: "Secure Access",
            description: "Protected content ensuring only enrolled students get the best resources."
          }
        ].map((feature, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="p-8 rounded-2xl bg-muted/50 border border-border hover:border-primary/50 transition-colors group"
          >
            <div className="mb-4 p-3 rounded-xl bg-background border border-border w-fit group-hover:scale-110 transition-transform">
              {feature.icon}
            </div>
            <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
            <p className="text-muted-foreground">{feature.description}</p>
          </motion.div>
        ))}
      </section>
    </div>
  );
}
