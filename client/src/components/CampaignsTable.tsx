"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ButtonColorful } from "@/components/ui/button-colorful";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { Campaign } from "@/lib/api";
import { useNavigate } from "react-router-dom";

import { Globe, Smartphone } from 'lucide-react';

interface CampaignsTableProps {
  campaigns: Campaign[];
}

const allColumns = [
  "Campaign",
  "Provider",
  "Progress",
  "Created At",
  "Status",
  "Action"
] as const;

export default function CampaignsTable({ campaigns }: CampaignsTableProps) {
  const [visibleColumns, setVisibleColumns] = useState<string[]>([...allColumns]);
  const [statusFilter, setStatusFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const navigate = useNavigate();

  const filteredData = campaigns.filter((campaign) => {
    return (
      (!statusFilter || campaign.status.toLowerCase() === statusFilter.toLowerCase()) &&
      (!nameFilter || campaign.name.toLowerCase().includes(nameFilter.toLowerCase()))
    );
  });

  const toggleColumn = (col: string) => {
    setVisibleColumns((prev) =>
      prev.includes(col)
        ? prev.filter((c) => c !== col)
        : [...prev, col]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-foreground text-background shadow-lg shadow-black/10 dark:shadow-white/10';
      case 'draft':
        return 'bg-muted text-muted-foreground border-border border';
      case 'paused':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/20 border';
      case 'completed':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20 border';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getProviderBadge = (provider: string) => {
    switch (provider) {
      case 'telnyx':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-900 dark:bg-white text-white text-xs font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            Telnyx
          </span>
        );
      case 'twilio':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F22F46] text-white text-xs font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-[#F22F46]/80" />
            Twilio
          </span>
        );
      case 'local':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-semibold border border-emerald-500/20">
            <Smartphone className="h-3 w-3" />
            Local SIM
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
            <Globe className="h-3 w-3" />
            {provider}
          </span>
        );
    }
  };

  return (
    <div className="w-full space-y-4 p-5 rounded-[1.25rem] bg-surface border border-black/5 dark:border-white/5 shadow-2xl">
      <div className="flex flex-wrap gap-4 items-center justify-between mb-4">
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="Search campaigns..."
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="w-48 xl:w-64"
          />
          <Input
            placeholder="Filter by status... (e.g. active)"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-48 lg:hidden xl:block"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="hidden sm:flex border border-black/10 dark:border-white/10">
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48">
            {allColumns.map((col) => (
              <DropdownMenuCheckboxItem
                key={col}
                checked={visibleColumns.includes(col)}
                onCheckedChange={() => toggleColumn(col)}
              >
                {col}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Table className="w-full">
        <TableHeader>
          <TableRow className="border-black/5 dark:border-white/5 hover:bg-transparent">
            {visibleColumns.includes("Campaign") && <TableHead className="w-[200px]">Campaign</TableHead>}
            {visibleColumns.includes("Provider") && <TableHead className="w-[100px]">Provider</TableHead>}
            {visibleColumns.includes("Progress") && <TableHead className="w-[120px]">Progress</TableHead>}
            {visibleColumns.includes("Created At") && <TableHead className="w-[120px] hidden md:table-cell">Created At</TableHead>}
            {visibleColumns.includes("Status") && <TableHead className="w-[100px] hidden sm:table-cell">Status</TableHead>}
            {visibleColumns.includes("Action") && <TableHead className="w-[160px] text-right">Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredData.length ? (
            filteredData.map((campaign) => {
              const progressPercentage = campaign.total_leads > 0 
                ? Math.round((campaign.leads_called / campaign.total_leads) * 100) 
                : 0;
                
return (
                  <TableRow key={campaign.id} className="border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] cursor-pointer" onClick={() => navigate(`/campaigns/${campaign.id}/manage`)}>
                   {visibleColumns.includes("Campaign") && (
                     <TableCell className="font-semibold whitespace-nowrap">
                       {campaign.name}
                     </TableCell>
                   )}
                   {visibleColumns.includes("Provider") && (
                     <TableCell className="whitespace-nowrap">
                       {getProviderBadge(campaign.provider)}
                     </TableCell>
                   )}
                   {visibleColumns.includes("Progress") && (
                    <TableCell className="whitespace-nowrap tabular-nums font-mono text-sm">
                       <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-foreground">{progressPercentage}%</span>
                          <span className="text-muted-foreground">{campaign.leads_called} / {campaign.total_leads}</span>
                        </div>
                        <div className="w-full h-1.5 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-foreground rounded-full transition-all duration-1000 ease-out" 
                            style={{ width: `${progressPercentage}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>
                  )}
                  {visibleColumns.includes("Created At") && (
                    <TableCell className="whitespace-nowrap text-muted-foreground text-sm hidden md:table-cell">
                      {new Date(campaign.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </TableCell>
                  )}
                  {visibleColumns.includes("Status") && (
                    <TableCell className="whitespace-nowrap hidden sm:table-cell">
                      <div
                        className={cn(
                          "px-2.5 py-1 text-[11px] uppercase tracking-widest font-bold w-fit rounded-lg",
                          getStatusColor(campaign.status)
                        )}
                      >
                        {campaign.status}
                      </div>
                    </TableCell>
                  )}
                  {visibleColumns.includes("Action") && (
                    <TableCell className="text-right">
                       <ButtonColorful 
                         onClick={(e) => {
                           e.stopPropagation();
                           navigate(`/campaigns/${campaign.id}/manage`);
                         }}
                         label={campaign.status === 'draft' ? 'Setup' : 'Manage'} 
                         className="h-8 px-3 rounded-lg text-xs" 
                       />
                    </TableCell>
                  )}
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} className="text-center py-10 h-32">
                <p className="text-muted-foreground font-medium">No campaigns found matching filters.</p>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
