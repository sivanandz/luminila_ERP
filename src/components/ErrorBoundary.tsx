"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundaryClass extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught application error:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full w-full items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4 shadow-lg">
            <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Something went wrong</h2>
              <p className="text-xs text-muted-foreground mt-1">
                An unexpected error occurred while rendering this view.
              </p>
            </div>
            {this.state.error?.message && (
              <div className="bg-background/80 rounded p-2.5 text-left border border-border">
                <p className="text-[11px] font-mono text-destructive break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="flex gap-2 justify-center pt-2">
              <button
                onClick={this.handleReset}
                className="px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-xs font-medium transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw size={12} />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundaryClass };

export function ErrorBoundary({ children, fallback }: Props) {
  const pathname = usePathname();
  return (
    <ErrorBoundaryClass key={pathname} fallback={fallback}>
      {children}
    </ErrorBoundaryClass>
  );
}
