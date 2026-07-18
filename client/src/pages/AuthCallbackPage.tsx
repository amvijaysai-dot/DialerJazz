import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { isLoading: _isLoading } = useAuth();

  useEffect(() => {
    // The InsForge SDK handles the OAuth callback automatically
    // getCurrentUser will process the callback and establish the session
    const checkAuth = async () => {
      try {
        // Wait for the auth context to process the callback
        // The AuthProvider's checkUser() will call getCurrentUser() which handles OAuth callbacks
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Navigate to dashboard after callback is processed
        navigate('/dashboard', { replace: true });
      } catch (err) {
        console.error('OAuth callback error:', err);
        toast.error('Authentication failed. Please try again.');
        navigate('/login', { replace: true });
      }
    };

    checkAuth();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center">
      <div className="text-center">
        <div className="h-12 w-12 border-2 border-foreground/20 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}