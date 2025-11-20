"use client";

import { Button } from "@/app/_components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/app/_components/ui/form";
import { Input } from "@/app/_components/ui/input";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { useProject } from "@/app/(main)/_hooks/project";
import { useConfigurableOptions } from "@/app/_hooks/server";
import { updateProject } from "@/app/(main)/_lib/projects";
import { mutate } from "swr";
import { toast } from "sonner";
import { Skeleton } from "@/app/_components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/app/_components/ui/accordion";

const formSchema = z.object({
  description: z.string().optional(),
  config: z.record(z.string(), z.string()),
});

interface EditProjectProps {
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EditProject({
  projectName,
  open,
  onOpenChange,
}: EditProjectProps) {
  const { data: project, isLoading: projectLoading } = useProject(projectName);
  const { data: configurableOptions, isLoading: optionsLoading } =
    useConfigurableOptions();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      description: "",
      config: {},
    },
    values: project
      ? {
          description: project.description || "",
          config: project.config || {},
        }
      : undefined,
  });

  const projectConfigOptions = configurableOptions?.configs.project || {};

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    try {
      await updateProject(projectName, values.config, values.description);
      await mutate("/1.0/projects?recursion=1");
      await mutate(`/1.0/projects/${projectName}`);
      toast.success("Project updated successfully");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update project"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isLoading = projectLoading || optionsLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Project: {projectName}</DialogTitle>
          <DialogDescription>
            Update the project configuration. See the{" "}
            <a
              href="https://linuxcontainers.org/incus/docs/main/reference/projects/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Incus documentation
            </a>{" "}
            for more information.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Project description"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <h3 className="text-sm font-medium">Configuration</h3>
                {Object.keys(projectConfigOptions).length > 0 ? (
                  <Accordion type="single" collapsible className="w-full">
                    {Object.entries(projectConfigOptions).map(
                      ([key, option]) => (
                        <AccordionItem key={key} value={key}>
                          <AccordionTrigger className="text-sm">
                            <div className="flex items-center gap-2">
                              <code className="text-xs bg-muted px-1 rounded">
                                {key}
                              </code>
                              {option.shortdesc && (
                                <span className="text-muted-foreground text-left">
                                  {option.shortdesc}
                                </span>
                              )}
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <FormField
                              control={form.control}
                              name={`config.${key}`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">
                                    {key}
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder={
                                        option.defaultdesc ||
                                        `Enter value for ${key}`
                                      }
                                      {...field}
                                      value={field.value ?? ""}
                                      onChange={(e) =>
                                        field.onChange(e.target.value)
                                      }
                                    />
                                  </FormControl>
                                  {option.longdesc && (
                                    <FormDescription className="text-xs">
                                      {option.longdesc}
                                    </FormDescription>
                                  )}
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </AccordionContent>
                        </AccordionItem>
                      )
                    )}
                  </Accordion>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No configuration options available. Configuration metadata
                    could not be loaded from the server.
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
