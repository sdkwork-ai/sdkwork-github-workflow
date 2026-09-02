use sdkwork_api_github_workflow_assembly as api_assembly;
use sdkwork_web_bootstrap::ApiModuleRegistry;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let bind_address = std::env::var("SDKWORK_GITHUB_WORKFLOW_APPLICATION_PUBLIC_INGRESS_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_owned());
    let mut module_registry = ApiModuleRegistry::new();
    module_registry.add_module(api_assembly::web_module()?);
    let app = module_registry
        .try_compose("SDKWork Github Workflow API")?
        .router;
    let listener = tokio::net::TcpListener::bind(&bind_address).await?;
    eprintln!("sdkwork-api-github-workflow-standalone-gateway listening on {bind_address}");
    axum::serve(listener, app).await?;
    Ok(())
}
