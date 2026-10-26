//! Coordinated shutdown.
//!
//! Resolves when the process receives SIGTERM (Kubernetes) or SIGINT (a
//! developer's terminal). Servers and workers await this to stop accepting
//! new work and finish in-flight work within the configured grace period.

use tracing::info;

pub async fn signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to install SIGINT handler");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(error) => {
                tracing::error!(%error, "failed to install SIGTERM handler");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => info!(signal = "SIGINT", "shutdown requested"),
        () = terminate => info!(signal = "SIGTERM", "shutdown requested"),
    }
}
